import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { D1AuthSessionRegistry } from "../lib/auth-session-registry.ts";
import { D1AccountDeletionStore, handleAccountDeletionRequest } from "../lib/account-deletion.ts";
import { D1R2AttachmentStore } from "../lib/d1-r2-attachments.ts";

function mockD1() {
  const db = new DatabaseSync(":memory:");
  return { db,
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; }, first() { return db.prepare(sql).get(...values) ?? null; },
        all() { return { results: db.prepare(sql).all(...values) }; }, run() { return db.prepare(sql).run(...values); },
        _sql: sql, _values: () => values };
    },
    batch(statements) { db.exec("BEGIN"); try { for (const item of statements) db.prepare(item._sql).run(...item._values()); db.exec("COMMIT"); return Promise.resolve([]); }
      catch (error) { db.exec("ROLLBACK"); return Promise.reject(error); } }
  };
}

const principal = { issuer: "https://identity.example.test/", subject: "account-42" };
const sessionId = "6e0c97b9-75c8-4f62-a931-85e4271e4a42";
const accountId = "8e0c97b9-75c8-4f62-a931-85e4271e4a42";

async function setup() {
  const d1 = mockD1();
  for (const migration of ["0001_sync.sql", "0002_attachments.sql", "0003_attachment_reconciliation.sql", "0004_sessions_feeds_retention.sql", "0005_sync_retention_cursor.sql"]) {
    d1.db.exec(await readFile(resolve(import.meta.dirname, `../sync-migrations/${migration}`), "utf8"));
  }
  d1.db.prepare("INSERT INTO sync_accounts(account_id,issuer,subject) VALUES(?,?,?)").run(accountId, principal.issuer, principal.subject);
  const now = Date.parse("2026-10-04T00:00:00.000Z");
  const registry = new D1AuthSessionRegistry(d1, () => now);
  return { d1, registry, now };
}

test("opaque server sessions can be listed and revoked without exposing reusable cookie secrets", async () => {
  const { d1, registry, now } = await setup();
  try {
    await registry.issue(principal, sessionId, now + 3_600_000);
    assert.equal(await registry.isActive(principal, sessionId), true);
    const [listed] = await registry.list(principal, sessionId);
    assert.equal(listed.current, true);
    assert.notEqual(listed.sessionKey, sessionId);
    assert.equal(listed.sessionKey.length, 64);
    assert.equal(await registry.isActive({ ...principal, subject: "other" }, sessionId), false);
    assert.equal(await registry.revoke(principal, listed.sessionKey), true);
    assert.equal(await registry.isActive(principal, sessionId), false);
    assert.equal((await registry.list(principal, sessionId)).length, 0);
  } finally { d1.db.close(); }
});

test("account deletion requires same-origin explicit confirmation and queues durable R2 cleanup", async () => {
  const { d1, registry } = await setup();
  try {
    await registry.issue(principal, sessionId, Date.parse("2026-10-04T01:00:00.000Z"));
    d1.db.prepare(`INSERT INTO sync_attachments(account_id,attachment_id,task_id,client_upload_id,object_key,file_name,media_type,byte_size,sha256)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(accountId, "attachment-a", "task-a", "upload-a", `${accountId}/attachment-a`, "a.txt", "text/plain", 1, "a".repeat(64));
    const auth = { authenticate: async () => principal };
    const store = new D1AccountDeletionStore(d1);
    const badOrigin = await handleAccountDeletionRequest(new Request("https://app.example.test/api/v1/account/delete", {
      method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "DELETE" })
    }), auth, store);
    assert.equal(badOrigin.status, 403);
    const noConfirmation = await handleAccountDeletionRequest(new Request("https://app.example.test/api/v1/account/delete", {
      method: "POST", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: JSON.stringify({})
    }), auth, store);
    assert.equal(noConfirmation.status, 400);
    const response = await handleAccountDeletionRequest(new Request("https://app.example.test/api/v1/account/delete", {
      method: "POST", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "DELETE" })
    }), auth, store);
    assert.equal(response.status, 202);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_accounts").get().count, 0);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_attachments").get().count, 0);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM auth_sessions").get().count, 0);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM account_deletion_jobs WHERE account_id=?").get(accountId).count, 1);

    const deleted = [];
    const objects = [`${accountId}/attachment-a`, `${accountId}/attachment-b`];
    const bucket = { put: async () => undefined, get: async () => null, delete: async key => { deleted.push(key); }, list: async ({ prefix, cursor }) => ({
      objects: objects.filter(key => key.startsWith(prefix) && (cursor ? key.endsWith("attachment-b") : key.endsWith("attachment-a")))
        .map(key => ({ key, uploaded: new Date() })), truncated: !cursor, ...(cursor ? {} : { cursor: "page-2" })
    }) };
    const attachmentStore = new D1R2AttachmentStore(d1, bucket);
    assert.deepEqual(await attachmentStore.processAccountDeletionJobs(2), { pages: 1, removed: 1, completed: 0 });
    assert.equal(d1.db.prepare("SELECT r2_cursor FROM account_deletion_jobs WHERE account_id=?").get(accountId).r2_cursor, "page-2");
    assert.deepEqual(await attachmentStore.processAccountDeletionJobs(2), { pages: 1, removed: 1, completed: 1 });
    assert.equal(deleted.length, 2);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM account_deletion_jobs").get().count, 0);
  } finally { d1.db.close(); }
});

test("retired server sessions stay revoked and expired sessions are not treated as active", async () => {
  const { d1, registry, now } = await setup();
  try {
    await registry.issue(principal, sessionId, now + 60_000);
    assert.equal(await registry.isActive(principal, sessionId), true);
    assert.equal(await registry.revokeAll(principal), 1);
    assert.equal(await registry.isActive(principal, sessionId), false);
    await registry.issue(principal, "7e0c97b9-75c8-4f62-a931-85e4271e4a43", now - 1);
    assert.equal(await registry.isActive(principal, "7e0c97b9-75c8-4f62-a931-85e4271e4a43"), false);
  } finally { d1.db.close(); }
});

test("concurrent first sessions for a new principal converge on one account", async () => {
  const { d1, registry, now } = await setup();
  try {
    const newPrincipal = { issuer: principal.issuer, subject: "first-login-race" };
    const sessions = ["7e0c97b9-75c8-4f62-a931-85e4271e4a43", "8e0c97b9-75c8-4f62-a931-85e4271e4a43"];
    await Promise.all(sessions.map(id => registry.issue(newPrincipal, id, now + 60_000)));
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM sync_accounts WHERE issuer=? AND subject=?").get(newPrincipal.issuer, newPrincipal.subject).count, 1);
    assert.equal(d1.db.prepare("SELECT count(*) AS count FROM auth_sessions WHERE account_id=(SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?)").get(newPrincipal.issuer, newPrincipal.subject).count, 2);
  } finally { d1.db.close(); }
});
