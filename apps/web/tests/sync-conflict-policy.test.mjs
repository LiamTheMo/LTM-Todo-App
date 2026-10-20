import test from "node:test";
import assert from "node:assert/strict";
import { conflictWinner } from "../lib/sync-conflict-policy.ts";

const at = minutes => new Date(Date.parse("2026-10-20T12:00:00.000Z") + minutes * 60_000).toISOString();
const upsert = (payload, queuedAt = Date.parse(at(0))) => ({ queuedAt, mutation: { entityType: "tasks", entityId: "task-1",
  baseRevision: 3, operation: "upsert", clientMutationId: "m-1", clientSchemaVersion: 4, payload } });
const remove = queuedAt => ({ queuedAt, mutation: { entityType: "tasks", entityId: "task-1", baseRevision: 3, operation: "delete",
  clientMutationId: "m-2", clientSchemaVersion: 4 } });
const remote = (payload, extra = {}) => ({ entityType: "tasks", entityId: "task-1", revision: 4, updatedAt: at(30), payload, ...extra });

test("the most recent edit wins a sync conflict", () => {
  assert.equal(conflictWinner(upsert({ updatedAt: at(10) }), remote({ updatedAt: at(5) })), "local");
  assert.equal(conflictWinner(upsert({ updatedAt: at(5) }), remote({ updatedAt: at(10) })), "remote");
});

test("ties and undated local edits keep the server copy so devices converge", () => {
  assert.equal(conflictWinner(upsert({ updatedAt: at(5) }), remote({ updatedAt: at(5) })), "remote");
  assert.equal(conflictWinner(upsert({ title: "no timestamp" }), remote({ updatedAt: at(5) })), "remote");
  assert.equal(conflictWinner(upsert({ updatedAt: at(5) }), remote({ title: "no timestamp" }, { updatedAt: "invalid" })), "local");
});

test("an edit always beats a deletion so neither device's work is discarded", () => {
  // Local edit vs remote deletion, in either order: keep the local edit.
  assert.equal(conflictWinner(upsert({ updatedAt: at(5) }), remote(undefined, { deletedAt: at(10), updatedAt: at(10) })), "local");
  assert.equal(conflictWinner(upsert({ updatedAt: at(20) }), remote(undefined, { deletedAt: at(10), updatedAt: at(10) })), "local");
  assert.equal(conflictWinner(upsert({ updatedAt: at(5) }), remote({ updatedAt: at(10), deletedAt: at(10) })), "local");
  // Local deletion (soft or removal) vs remote edit, in either order: keep the remote edit.
  assert.equal(conflictWinner(upsert({ updatedAt: at(0), deletedAt: at(20) }), remote({ updatedAt: at(10) })), "remote");
  assert.equal(conflictWinner(remove(Date.parse(at(20))), remote({ updatedAt: at(10) })), "remote");
  assert.equal(conflictWinner(remove(Date.parse(at(5))), remote({ updatedAt: at(10) })), "remote");
});

test("a deletion on both sides keeps the server copy", () => {
  assert.equal(conflictWinner(remove(Date.parse(at(50))), remote(undefined, { deletedAt: at(10), updatedAt: at(10) })), "remote");
  assert.equal(conflictWinner(upsert({ updatedAt: at(50), deletedAt: at(50) }), remote(undefined, { deletedAt: at(10), updatedAt: at(10) })), "remote");
});

test("a record missing on the server is recreated from the local copy", () => {
  assert.equal(conflictWinner(upsert({ updatedAt: at(0) }), undefined), "local");
});
