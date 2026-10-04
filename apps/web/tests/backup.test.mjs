import test from "node:test";
import assert from "node:assert/strict";
import { emptyData, newEntity } from "../lib/domain.ts";
import { createBackup, parseBackup, MAX_BACKUP_BYTES } from "../lib/backup.ts";

test("versioned backups preserve stable identities and all local collections", () => {
  const data = emptyData();
  const task = { ...newEntity(), title: "Keep stable ID", notes: "", priority: "high", tagIds: [], sortKey: 4 };
  data.tasks.push(task);
  data.savedViews.push({ ...newEntity(), name: "Work", query: "", dateScope: "upcoming" });
  const backup = createBackup(data, "2026-10-03T12:00:00.000Z");
  const restored = parseBackup(JSON.stringify(backup));
  assert.equal(restored.tasks[0].id, task.id);
  assert.equal(restored.tasks[0].title, task.title);
  assert.equal(restored.savedViews[0].dateScope, "upcoming");
  assert.equal(restored.schemaVersion, 4);
  const legacy = emptyData(); legacy.schemaVersion = 3;
  const migratedBackup = createBackup(legacy);
  assert.equal(migratedBackup.schemaVersion, migratedBackup.data.schemaVersion);
});

test("backup restore rejects unsupported versions, malformed relationships, and oversized files", () => {
  const valid = createBackup(emptyData());
  assert.throws(() => parseBackup("not JSON"), /valid JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, formatVersion: 2 })), /not supported/);
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, schemaVersion: 3 })), /does not match/);
  const badRelationship = structuredClone(valid);
  badRelationship.data.sections.push({ ...newEntity(), projectId: "missing", name: "Bad", sortKey: 0 });
  assert.throws(() => parseBackup(JSON.stringify(badRelationship)), /missing project/);
  assert.throws(() => parseBackup("x".repeat(MAX_BACKUP_BYTES + 1)), /16 MB/);
  const tooLarge = emptyData();
  tooLarge.tasks.push({ ...newEntity(), title: "x".repeat(MAX_BACKUP_BYTES + 1), notes: "", priority: "none", tagIds: [], sortKey: 0 });
  assert.throws(() => createBackup(tooLarge), /16 MB/);
});
