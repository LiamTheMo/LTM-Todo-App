import "fake-indexeddb/auto";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../lib/domain.ts";
import { acknowledgeAttachmentUpload, acknowledgeSyncMutation, applyRemoteSyncChanges, bindSyncAccount, hasSyncConflicts, queueAttachmentUpload, readData, readPendingAttachmentUploads, readPendingSyncMutations, readSyncConflicts, recordSyncConflict, resolveSyncConflict, writeData } from "../lib/storage.ts";

const stamp = "2026-10-03T12:00:00.000Z";
const taskId = "4fef5e72-f114-4ea5-8d40-9d8069654f40";
const task = (title = "Local task", revision = 1) => ({ id: taskId, title, notes: "", priority: "none", tagIds: [], sortKey: 1,
  createdAt: stamp, updatedAt: stamp, revision });

beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("ltm-todo");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Test database remained open"));
  });
});

test("local commits atomically queue upserts and coalesce retries against server revisions", async () => {
  const data = emptyData();
  data.tasks.push(task());
  await writeData({ ...data, generation: 1 }, 0);
  let pending = await readPendingSyncMutations(12);
  assert.equal(pending.length, 1);
  const taskMutation = pending.find(item => item.entityType === "tasks");
  assert.equal(taskMutation.baseRevision, 0);
  await acknowledgeSyncMutation(taskMutation, 7);

  const saved = await readData();
  const updated = { ...saved, generation: saved.generation + 1,
    tasks: saved.tasks.map(item => item.id === taskId ? { ...item, title: "Changed locally", revision: item.revision + 1, updatedAt: "2026-10-03T13:00:00.000Z" } : item) };
  await writeData(updated, saved.generation);
  pending = await readPendingSyncMutations(12);
  const updatedMutation = pending.find(item => item.entityType === "tasks");
  assert.equal(updatedMutation.baseRevision, 7);
  assert.equal(updatedMutation.payload.title, "Changed locally");
});

test("deleting a server-known entity queues a content-free tombstone", async () => {
  const data = emptyData();
  data.tasks.push(task());
  await writeData({ ...data, generation: 1 }, 0);
  const create = (await readPendingSyncMutations(12)).find(item => item.entityType === "tasks");
  await acknowledgeSyncMutation(create, 3);
  const saved = await readData();
  await writeData({ ...saved, generation: saved.generation + 1, tasks: [] }, saved.generation);
  const deletion = (await readPendingSyncMutations(12)).find(item => item.entityType === "tasks");
  assert.equal(deletion.operation, "delete");
  assert.equal(deletion.baseRevision, 3);
  assert.equal("payload" in deletion, false);
});

test("remote changes apply without being re-enqueued; local pending edits are preserved as conflicts", async () => {
  const remote = { ...task("Remote task"), id: "f106a9a8-a363-4fc8-979f-1604211c4e53" };
  await applyRemoteSyncChanges([{ entityType: "tasks", entityId: remote.id, revision: 5, updatedAt: stamp, payload: remote }]);
  let data = await readData();
  assert.equal(data.tasks[0].title, "Remote task");
  assert.equal((await readPendingSyncMutations(12)).length, 0);

  const local = { ...data, generation: data.generation + 1,
    tasks: data.tasks.map(item => item.id === remote.id ? { ...item, title: "My offline edit", revision: item.revision + 1 } : item) };
  await writeData(local, data.generation);
  const pending = (await readPendingSyncMutations(12)).find(item => item.entityType === "tasks");
  await recordSyncConflict(pending, { entityType: "tasks", entityId: remote.id, revision: 6, updatedAt: stamp,
    payload: { ...remote, title: "Other device edit", revision: 6 } });
  await applyRemoteSyncChanges([{ entityType: "tasks", entityId: remote.id, revision: 6, updatedAt: stamp,
    payload: { ...remote, title: "Other device edit", revision: 6 } }]);
  data = await readData();
  assert.equal(data.tasks[0].title, "My offline edit");
  assert.equal(await hasSyncConflicts(), true);
  assert.equal((await readPendingSyncMutations(12)).find(item => item.entityType === "tasks").payload.title, "My offline edit");
  const [conflict] = await readSyncConflicts();
  await resolveSyncConflict(conflict.key, "local");
  const rebased = (await readPendingSyncMutations(12)).find(item => item.entityType === "tasks");
  assert.equal(rebased.baseRevision, 6);
  assert.equal(rebased.payload.title, "My offline edit");
  assert.equal(await hasSyncConflicts(), false);
});

test("choosing the remote side atomically replaces the local entity and clears its pending mutation", async () => {
  const remote = { ...task("Remote revision"), id: "f106a9a8-a363-4fc8-979f-1604211c4e53", revision: 9 };
  await applyRemoteSyncChanges([{ entityType: "tasks", entityId: remote.id, revision: 9, updatedAt: stamp, payload: remote }]);
  let data = await readData();
  await writeData({ ...data, generation: data.generation + 1,
    tasks: data.tasks.map(item => item.id === remote.id ? { ...item, title: "Local revision", revision: item.revision + 1 } : item) }, data.generation);
  const [pending] = (await readPendingSyncMutations(12)).filter(item => item.entityId === remote.id);
  await recordSyncConflict(pending, { entityType: "tasks", entityId: remote.id, revision: 10, updatedAt: stamp,
    payload: { ...remote, title: "Remote revision 2", revision: 10 } });
  const [conflict] = (await readSyncConflicts()).filter(item => item.key === `tasks:${remote.id}`);
  await resolveSyncConflict(conflict.key, "remote");
  data = await readData();
  assert.equal(data.tasks.find(item => item.id === remote.id).title, "Remote revision 2");
  assert.equal((await readPendingSyncMutations(12)).some(item => item.entityId === remote.id), false);
  assert.equal(await hasSyncConflicts(), false);
});

test("a local profile cannot silently upload its outbox into a different account", async () => {
  assert.equal(await bindSyncAccount("a".repeat(43)), true);
  assert.equal(await bindSyncAccount("a".repeat(43)), true);
  assert.equal(await bindSyncAccount("b".repeat(43)), false);
  assert.equal(await bindSyncAccount("not-a-key"), false);
});

test("offline attachment placeholders survive reload until explicitly acknowledged", async () => {
  const queued = await queueAttachmentUpload({ taskId, fileName: "notes.txt", mediaType: "text/plain", blob: new Blob(["hello"]) });
  const items = await readPendingAttachmentUploads();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, queued.id);
  assert.equal(items[0].blob.size, 5);
  assert.ok(items[0].uploadId);
  await acknowledgeAttachmentUpload(queued.id);
  assert.deepEqual(await readPendingAttachmentUploads(), []);
});

test("attachment queue rejects empty or oversized files before persistence", async () => {
  await assert.rejects(() => queueAttachmentUpload({ taskId, fileName: "empty.txt", mediaType: "text/plain", blob: new Blob([]) }), /invalid|exceeds/i);
  await assert.rejects(() => queueAttachmentUpload({ taskId, fileName: "large.txt", mediaType: "text/plain", blob: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) }), /10 MiB/i);
});
