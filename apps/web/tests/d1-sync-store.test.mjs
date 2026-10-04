import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { D1SyncStore } from "../lib/d1-sync-store.ts";
import { AccountSyncCoordinator } from "../lib/account-sync-coordinator.ts";
import { SyncCursorCodec } from "../lib/sync-cursor.ts";
import { InvalidSyncRelationshipError, SyncMutationConflictError } from "../lib/sync-api.ts";
import { InvalidSyncCursorError } from "../lib/sync-api.ts";
import { maintainSyncRetention } from "../lib/sync-retention.ts";

function mockD1() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        first() { return db.prepare(sql).get(...values) ?? null; },
        all() { return { results: db.prepare(sql).all(...values) }; },
        run() { return db.prepare(sql).run(...values); },
        _sql: sql,
        _values: () => values
      };
    },
    batch(statements) {
      db.exec("BEGIN");
      try {
        for (const statement of statements) db.prepare(statement._sql).run(...statement._values());
        db.exec("COMMIT");
        return Promise.resolve([]);
      } catch (error) { db.exec("ROLLBACK"); return Promise.reject(error); }
    }
  };
}
const accountA = { issuer: "https://identity.example.test/", subject: "alice" };
const accountB = { issuer: "https://identity.example.test/", subject: "bob" };
const projectId = "d4bf1428-baae-4cd5-9852-6c79344aa139";
const taskId = "4fef5e72-f114-4ea5-8d40-9d8069654f40";
let mutationSerial = 1;
function mutation(entityType, entityId, payload, baseRevision = 0) {
  const serial = String(mutationSerial++).padStart(12, "0");
  return { entityType, entityId, payload, baseRevision, clientMutationId: `00000000-0000-4000-8000-${serial}`,
    clientSchemaVersion: 4, operation: "upsert" };
}
const project = { id: projectId, name: "Personal", color: "orange", sortKey: 0, createdAt: "2026-10-03T12:00:00.000Z", updatedAt: "2026-10-03T12:00:00.000Z", revision: 1 };
const task = { id: taskId, title: "Initial", notes: "", priority: "none", projectId, tagIds: [], sortKey: 0,
  createdAt: "2026-10-03T12:00:00.000Z", updatedAt: "2026-10-03T12:00:00.000Z", revision: 1 };

async function setup() {
  const d1 = mockD1();
  for (const migration of ["0001_sync.sql", "0002_attachments.sql", "0003_attachment_reconciliation.sql", "0004_sessions_feeds_retention.sql", "0005_sync_retention_cursor.sql"]) {
    d1.db.exec(await readFile(resolve(import.meta.dirname, `../sync-migrations/${migration}`), "utf8"));
  }
  const codec = new SyncCursorCodec(Buffer.alloc(32, 17).toString("base64url"));
  return { d1, store: new D1SyncStore(d1, codec) };
}

test("D1 sync persists account-scoped changes, cursors, tombstones and idempotent results", async () => {
  const { d1, store } = await setup();
  try {
    const batch = [mutation("projects", projectId, project), mutation("tasks", taskId, task)];
    const accepted = await store.push(accountA, { protocolVersion: 1, mutations: batch });
    assert.deepEqual(accepted.results.map(item => [item.status, item.revision]), [["accepted", 1], ["accepted", 1]]);
    assert.deepEqual(await store.push(accountA, { protocolVersion: 1, mutations: batch }), accepted);
    const page1 = await store.pull(accountA, undefined, 1);
    assert.equal(page1.changes[0].entityId, projectId);
    assert.equal(page1.hasMore, true);
    const page2 = await store.pull(accountA, page1.cursor, 1);
    assert.equal(page2.changes[0].entityId, taskId);
    assert.equal(page2.hasMore, false);
    assert.deepEqual((await store.pull(accountB, undefined, 10)).changes, []);

    const del = { entityType: "tasks", entityId: taskId, operation: "delete", baseRevision: 1,
      clientMutationId: "00000000-0000-4000-8000-000000000099", clientSchemaVersion: 4 };
    const deleted = await store.push(accountA, { protocolVersion: 1, mutations: [del] });
    const afterDelete = await store.pull(accountA, page2.cursor, 10);
    assert.equal(deleted.results[0].status, "accepted");
    assert.equal(typeof afterDelete.changes[0].deletedAt, "string");
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_journal").get().count, 3);
  } finally { d1.db.close(); }
});

test("D1 sync rejects missing relationships, reused mutation IDs and account-mismatched cursors", async () => {
  const { d1, store } = await setup();
  try {
    const bad = mutation("tasks", taskId, { ...task, projectId: "c9d2d7c8-25eb-4f11-9f2d-f10540764b9a" });
    await assert.rejects(() => store.push(accountA, { protocolVersion: 1, mutations: [bad] }), InvalidSyncRelationshipError);
    const valid = mutation("projects", projectId, project);
    await store.push(accountA, { protocolVersion: 1, mutations: [valid] });
    await assert.rejects(() => store.push(accountA, { protocolVersion: 1,
      mutations: [{ ...valid, payload: { ...project, name: "changed" } }] }), SyncMutationConflictError);
    const cursor = (await store.pull(accountA, undefined, 10)).cursor;
    await assert.rejects(() => store.pull(accountB, cursor, 10));
  } finally { d1.db.close(); }
});

test("stable snapshots recover compacted journal state and then resume concurrent changes", async () => {
  const { d1, store } = await setup();
  try {
    await store.push(accountA, { protocolVersion: 1, mutations: [mutation("projects", projectId, project), mutation("tasks", taskId, task)] });
    const deletedTask = { entityType: "tasks", entityId: taskId, operation: "delete", baseRevision: 1,
      clientMutationId: "00000000-0000-4000-8000-000000000098", clientSchemaVersion: 4 };
    await store.push(accountA, { protocolVersion: 1, mutations: [deletedTask] });
    const first = await store.snapshot(accountA, undefined, 1);
    assert.equal(first.complete, false);
    assert.equal(first.changes[0].entityType, "projects");

    const changedProject = { ...project, name: "Updated during snapshot", revision: 2 };
    await store.push(accountA, { protocolVersion: 1, mutations: [mutation("projects", projectId, changedProject, 1)] });
    const second = await store.snapshot(accountA, first.snapshotCursor, 2);
    assert.equal(second.complete, true);
    assert.equal(second.changes.length, 1);
    assert.equal(second.changes[0].deletedAt !== undefined, true);
    const incremental = await store.pull(accountA, second.cursor, 10);
    assert.equal(incremental.changes.length, 1);
    assert.equal(incremental.changes[0].payload.name, "Updated during snapshot");

    await maintainSyncRetention(d1, Date.now() + 40 * 86_400_000);
    await assert.rejects(() => store.pull(accountA, undefined, 10), InvalidSyncCursorError);
    const recovered = await store.snapshot(accountA, undefined, 10);
    assert.equal(recovered.complete, true);
    assert.equal(recovered.changes.length, 2);
    assert.equal(recovered.changes.find(item => item.entityType === "tasks").deletedAt !== undefined, true);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_journal").get().count, 0);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_entities WHERE deleted_at IS NOT NULL").get().count, 1);
  } finally { d1.db.close(); }
});

test("scheduled retention pages through every account instead of starving accounts after the first batch", async () => {
  const { d1 } = await setup();
  try {
    for (let index = 0; index < 205; index++) {
      const id = String(index).padStart(3, "0");
      d1.db.prepare("INSERT INTO sync_accounts(account_id,issuer,subject) VALUES(?,?,?)").run(`account-${id}`, `issuer-${id}`, `subject-${id}`);
    }
    const now = Date.parse("2026-10-04T00:00:00.000Z");
    await maintainSyncRetention(d1, now);
    assert.equal(d1.db.prepare("SELECT state_value FROM sync_retention_state WHERE state_key='accounts'").get().state_value, "account-099");
    await maintainSyncRetention(d1, now);
    assert.equal(d1.db.prepare("SELECT state_value FROM sync_retention_state WHERE state_key='accounts'").get().state_value, "account-199");
    await maintainSyncRetention(d1, now);
    assert.equal(d1.db.prepare("SELECT state_value FROM sync_retention_state WHERE state_key='accounts'").get().state_value, "");
  } finally { d1.db.close(); }
});

test("journal compaction waits for active device acknowledgements and advances a recovery floor", async () => {
  const { d1, store } = await setup();
  try {
    await store.push(accountA, { protocolVersion: 1, mutations: [mutation("projects", projectId, project)] });
    const account = d1.db.prepare("SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?").get(accountA.issuer, accountA.subject);
    const deviceId = "af73a551-d5c7-4241-8483-b22c4d75b8c9";
    d1.db.prepare(`INSERT INTO sync_devices(account_id,device_id,display_name,client_kind,acknowledged_sequence,last_seen_at)
      VALUES(?,?,?,'web',0,?)`).run(account.account_id, deviceId, "Active browser", "2026-10-03T00:00:00.000Z");
    const now = Date.parse("2026-11-13T00:00:00.000Z");
    await maintainSyncRetention(d1, now);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_journal WHERE account_id=?").get(account.account_id).count, 1);
    assert.equal(d1.db.prepare("SELECT min_available_sequence FROM sync_accounts WHERE account_id=?").get(account.account_id).min_available_sequence, 0);
    d1.db.prepare("UPDATE sync_devices SET acknowledged_sequence=1 WHERE account_id=? AND device_id=?").run(account.account_id, deviceId);
    await maintainSyncRetention(d1, now);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_journal WHERE account_id=?").get(account.account_id).count, 0);
    assert.equal(d1.db.prepare("SELECT min_available_sequence FROM sync_accounts WHERE account_id=?").get(account.account_id).min_available_sequence, 1);
  } finally { d1.db.close(); }
});

test("per-account Durable Object serializes concurrent writes against the same base revision", async () => {
  const { d1, store } = await setup();
  try {
    await store.push(accountA, { protocolVersion: 1, mutations: [mutation("projects", projectId, project)] });
    const coordinator = new AccountSyncCoordinator({}, { SYNC_DB: d1, SYNC_CURSOR_SECRET: Buffer.alloc(32, 17).toString("base64url") });
    const makeRequest = title => new Request("https://sync-coordinator.internal/", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "push", principal: accountA,
        batch: { protocolVersion: 1, mutations: [mutation("projects", projectId, { ...project, name: title }, 1)] } }) });
    const [left, right] = await Promise.all([coordinator.fetch(makeRequest("Left")), coordinator.fetch(makeRequest("Right"))]);
    const bodies = await Promise.all([left.json(), right.json()]);
    assert.deepEqual(bodies.map(body => body.results[0].status).sort(), ["accepted", "conflict"]);
    assert.equal((await store.pull(accountA, undefined, 10)).changes.length, 2);
  } finally { d1.db.close(); }
});
