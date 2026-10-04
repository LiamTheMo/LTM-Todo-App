import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { D1R2AttachmentStore } from "../lib/d1-r2-attachments.ts";
import { D1SyncStore } from "../lib/d1-sync-store.ts";
import { SyncCursorCodec } from "../lib/sync-cursor.ts";

function mockD1() {
  const db = new DatabaseSync(":memory:");
  return { db, prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; }, first() { return db.prepare(sql).get(...values) ?? null; },
      all() { return { results: db.prepare(sql).all(...values) }; }, run() { return db.prepare(sql).run(...values); },
      _sql: sql, _values: () => values };
  }, batch(statements) {
    db.exec("BEGIN");
    try { for (const item of statements) db.prepare(item._sql).run(...item._values()); db.exec("COMMIT"); return Promise.resolve([]); }
    catch (error) { db.exec("ROLLBACK"); return Promise.reject(error); }
  } };
}
const principal = { issuer: "https://identity.example.test/", subject: "alice" };
const other = { issuer: "https://identity.example.test/", subject: "bob" };
const taskId = "4fef5e72-f114-4ea5-8d40-9d8069654f40";

test("D1 attachment metadata stays account-scoped and orphan cleanup is retried from the outbox", async () => {
  const db = mockD1();
  for (const migration of ["0001_sync.sql", "0002_attachments.sql", "0003_attachment_reconciliation.sql", "0004_sessions_feeds_retention.sql", "0005_sync_retention_cursor.sql"]) {
    db.db.exec(await readFile(resolve(import.meta.dirname, `../sync-migrations/${migration}`), "utf8"));
  }
  const secret = Buffer.alloc(32, 9).toString("base64url");
  const sync = new D1SyncStore(db, new SyncCursorCodec(secret));
  await sync.push(principal, { protocolVersion: 1, mutations: [{ entityType: "tasks", entityId: taskId,
    payload: { id: taskId, title: "Attach", notes: "", priority: "none", tagIds: [], sortKey: 0,
      createdAt: "2026-10-03T12:00:00.000Z", updatedAt: "2026-10-03T12:00:00.000Z", revision: 1 },
    baseRevision: 0, clientMutationId: "00000000-0000-4000-8000-000000000001", clientSchemaVersion: 4, operation: "upsert" }] });
  const objects = new Map(); const uploadedAt = new Map(); let failDelete = true; let cleanupTarget;
  const bucket = { async put(key, body) { objects.set(key, new Uint8Array(body)); uploadedAt.set(key, new Date()); }, async get(key) {
    const value = objects.get(key); return value ? { body: new ReadableStream({ start(controller) { controller.enqueue(value); controller.close(); } }) } : null;
  }, async delete(key) { if (key === cleanupTarget && failDelete) { failDelete = false; throw new Error("transient R2 failure"); } objects.delete(key); uploadedAt.delete(key); },
  async list({ limit }) { return { objects: [...objects.keys()].slice(0, limit).map(key => ({ key, uploaded: uploadedAt.get(key) })), truncated: false }; } };
  const store = new D1R2AttachmentStore(db, bucket);
  try {
    const metadata = await store.upload(principal, { uploadId: "00000000-0000-4000-8000-000000000002", taskId,
      fileName: "note.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("note"), sha256: "a".repeat(64) });
    cleanupTarget = [...objects.keys()].find(key => key.endsWith(`/${metadata.id}`));
    assert.equal((await store.list(principal)).length, 1);
    const now = Date.now();
    objects.set("orphan/old", new Uint8Array([1])); uploadedAt.set("orphan/old", new Date(now - 25 * 60 * 60 * 1000));
    objects.set("orphan/recent", new Uint8Array([2])); uploadedAt.set("orphan/recent", new Date(now - 60 * 60 * 1000));
    assert.deepEqual(await store.reconcileOrphans(100, now), { inspected: 3, removed: 1, next: false });
    assert.equal([...objects.keys()].some(key => key.endsWith(`/${metadata.id}`)), true);
    assert.equal(objects.has("orphan/old"), false);
    assert.equal(objects.has("orphan/recent"), true);
    assert.equal(await store.download(other, metadata.id), undefined);
    assert.equal(await store.remove(principal, metadata.id), true);
    assert.equal(db.db.prepare("SELECT count(*) AS count FROM attachment_cleanup_outbox").get().count, 1);
    assert.deepEqual(await store.processCleanup(), { removed: 1, deferred: 0 });
    assert.deepEqual([...objects.keys()], ["orphan/recent"]);
  } finally { db.db.close(); }
});
