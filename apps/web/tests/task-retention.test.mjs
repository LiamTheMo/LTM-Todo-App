import "fake-indexeddb/auto";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { emptyData, newEntity, otherDashboardTasks, pruneExpiredHistory } from "../lib/domain.ts";
import { ACCOUNT_PREFERENCES_ID, completedTaskRetentionDays, setCompletedTaskRetentionDays } from "../lib/task-retention.ts";
import { acknowledgeSyncMutation, applyRemoteSyncChanges, readData, readPendingSyncMutations, writeData, normalizeData } from "../lib/storage.ts";
import { parseSyncPushBatch } from "../lib/sync-protocol.ts";
import { createBackup, parseBackup } from "../lib/backup.ts";

const stamp = "2026-10-07T12:00:00.000Z";
const task = (id, completedAt, extras = {}) => ({ ...newEntity(), id, title: id, notes: "", priority: "low", tagIds: [], sortKey: 1, completedAt, ...extras });
beforeEach(async () => new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase("ltm-todo"); request.onsuccess = resolve; request.onerror = reject; }));

test("Other tasks groups completed items last while preserving order within groups", () => {
  const data = emptyData();
  data.tasks.push(task("done-high", stamp, { priority: "high" }), task("open-low", undefined), task("open-high", undefined, { priority: "high" }), task("done-low", stamp));
  assert.deepEqual(otherDashboardTasks(data, "2026-10-07").map(item => item.id), ["open-high", "open-low", "done-high", "done-low"]);
});
test("completed retention defaults to seven days, accepts only one to fourteen, and survives backups", () => {
  const data = emptyData();
  assert.equal(completedTaskRetentionDays(data), 7);
  for (const value of [0, 15, 1.5, NaN]) assert.equal(setCompletedTaskRetentionDays(data, value), data);
  const updated = setCompletedTaskRetentionDays(data, 14);
  assert.equal(completedTaskRetentionDays(parseBackup(JSON.stringify(createBackup(updated)))), 14);
  assert.equal(setCompletedTaskRetentionDays(updated, 14), updated);
  assert.throws(() => normalizeData({ ...updated, preferences: [{ ...updated.preferences[0], completedTaskRetentionDays: 15 }] }));
});
test("expiry uses completion date for all tasks and preserves active recurring tasks", () => {
  const data = emptyData();
  data.tasks.push(task("seven-days", "2026-09-30T12:00:00Z"), task("six-days", "2026-10-01T12:00:00Z"), task("future-due-done", "2026-09-30T12:00:00Z", { dueDate: "2026-11-01" }), task("recent-old-due", "2026-10-06T12:00:00Z", { dueDate: "2026-08-01" }), task("active-repeat", undefined, { recurrence: { frequency: "daily", interval: 1, anchorDate: "2026-10-07", occurrences: 10 } }));
  data.completions.push({ id: "old-repeat-completion", taskId: "active-repeat", completedAt: "2026-09-30T12:00:00Z", occurrenceDate: "2026-09-30" });
  data.blocks.push({ ...newEntity(), taskId: "seven-days", startInstant: stamp, endInstant: "2026-10-07T13:00:00Z", timeZone: "UTC" });
  data.reminders.push({ ...newEntity(), taskId: "seven-days", minutesBefore: 5, enabled: true });
  const retained = pruneExpiredHistory(data, "2026-10-07");
  assert.deepEqual(retained.tasks.map(item => item.id), ["six-days", "recent-old-due", "active-repeat"]);
  assert.deepEqual(retained.completions, []);
  assert.deepEqual(retained.blocks, []);
  assert.deepEqual(retained.reminders, []);
  assert.ok(pruneExpiredHistory(setCompletedTaskRetentionDays(data, 14), "2026-10-07").tasks.some(item => item.id === "seven-days"));
  assert.equal(pruneExpiredHistory(data, "2026-10-07", false), data);
});
test("cleanup is journaled and preference changes sync before dependent tasks", async () => {
  const data = setCompletedTaskRetentionDays(emptyData(), 14);
  data.tasks.push(task("4fef5e72-f114-4ea5-8d40-9d8069654f40", "2026-09-23T12:00:00Z"));
  await writeData({ ...data, generation: 1 }, 0);
  const pending = await readPendingSyncMutations(12);
  assert.equal(pending[0].entityType, "preferences");
  for (const mutation of pending) await acknowledgeSyncMutation(mutation, 1);
  const loaded = await readData("2026-10-07");
  assert.equal(loaded.tasks.length, 1, "loading must not discard records before journaling");
  const retained = pruneExpiredHistory(loaded, "2026-10-07");
  await writeData({ ...retained, generation: loaded.generation + 1 }, loaded.generation);
  assert.ok((await readPendingSyncMutations(12)).some(item => item.entityType === "tasks" && item.operation === "delete"));
});
test("remote account retention restores on another device and rejects invalid wire values", async () => {
  const preference = setCompletedTaskRetentionDays(emptyData(), 14).preferences[0];
  await applyRemoteSyncChanges([{ sequence: 1, entityType: "preferences", entityId: ACCOUNT_PREFERENCES_ID, revision: 1, clientSchemaVersion: 4, payload: preference, updatedAt: preference.updatedAt }]);
  assert.equal(completedTaskRetentionDays(await readData()), 14);
  const mutation = { entityType: "preferences", entityId: ACCOUNT_PREFERENCES_ID, baseRevision: 0, operation: "upsert", clientMutationId: crypto.randomUUID(), clientSchemaVersion: 4, payload: preference };
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(new URL("../../../shared/schemas/sync-v1.schema.json", import.meta.url), "utf8")));
  assert.equal(validate({ protocolVersion: 1, mutations: [mutation] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ protocolVersion: 1, mutations: [{ ...mutation, payload: { ...preference, completedTaskRetentionDays: 15 } }] }), false);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [mutation] }).ok, true);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [{ ...mutation, payload: { ...preference, completedTaskRetentionDays: 15 } }] }).ok, false);
});
test("cloud migration preserves records, revisions and tombstones and accepts preferences", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of ["0001_sync.sql", "0002_attachments.sql", "0003_attachment_reconciliation.sql", "0004_sessions_feeds_retention.sql", "0005_sync_retention_cursor.sql"]) db.exec(readFileSync(new URL(`../sync-migrations/${name}`, import.meta.url), "utf8"));
  db.exec("INSERT INTO sync_accounts(account_id,issuer,subject) VALUES('a','issuer','subject')");
  db.exec(`INSERT INTO sync_entities VALUES('a','tasks','t',9,4,'{}',NULL,'${stamp}',42),('a','tasks','deleted',10,4,NULL,'${stamp}','${stamp}',43)`);
  const before = db.prepare("SELECT * FROM sync_entities ORDER BY entity_id").all();
  db.exec(readFileSync(new URL("../sync-migrations/0006_account_preferences.sql", import.meta.url), "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM sync_entities ORDER BY entity_id").all(), before);
  db.prepare("INSERT INTO sync_entities VALUES('a','preferences',?,1,4,?,NULL,?,44)").run(ACCOUNT_PREFERENCES_ID, JSON.stringify(setCompletedTaskRetentionDays(emptyData(), 14).preferences[0]), stamp);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sync_entities").get().count, 3);
  db.close();
});
