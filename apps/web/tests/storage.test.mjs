import test from "node:test";
import assert from "node:assert/strict";
import { normalizeData } from "../lib/storage.ts";

test("legacy v1 snapshots gain missing collections and a generation without losing tasks", () => {
  const legacy = { schemaVersion: 1, tasks: [{ id: "task", title: "Keep me", notes: "", tagIds: [], sortKey: 1,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 }] };
  const restored = normalizeData(legacy);
  assert.equal(restored.generation, 0);
  assert.equal(restored.tasks[0].title, "Keep me");
  assert.deepEqual(restored.sections, []);
  assert.deepEqual(restored.completions, []);
  assert.equal(normalizeData({ ...legacy, generation: 7 }).generation, 7);
});

test("corrupt or unsupported snapshots fail closed instead of being replaced", () => {
  assert.throws(() => normalizeData({ schemaVersion: 2, tasks: [] }), /Unsupported/);
  assert.throws(() => normalizeData({ schemaVersion: 1, tasks: "not an array" }), /Invalid tasks/);
  assert.throws(() => normalizeData({ schemaVersion: 1, tasks: [{ id: "a", title: "", tagIds: [], sortKey: 1,
    createdAt: "2026-01-01", updatedAt: "2026-01-01", revision: 1 }] }), /Invalid local task/);
  assert.throws(() => normalizeData({ schemaVersion: 1, generation: -1 }), /generation/);
  assert.throws(() => normalizeData({ schemaVersion: 1, tags: [{ id: "same", createdAt: "", updatedAt: "", revision: 1 },
    { id: "same", createdAt: "", updatedAt: "", revision: 1 }] }), /duplicate tags/);
});
