import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IDBFactory } from "fake-indexeddb";
import { D1SyncStore } from "../lib/d1-sync-store.ts";
import { SyncCursorCodec } from "../lib/sync-cursor.ts";
import { DeviceRegistry } from "../lib/device-registry.ts";
import { handleDeviceRequest } from "../lib/device-api.ts";
import { handleSyncRequest, handleSyncSnapshotRequest } from "../lib/sync-api.ts";
import { SyncClient } from "../lib/sync-client.ts";
import { completeTask, newEntity, saveTask } from "../lib/domain.ts";
import { acknowledgeSyncMutation, applyRemoteSyncChanges, autoResolveSyncConflicts, bindSyncAccount, getSyncCursor,
  getSyncSnapshotCursor, hasSyncConflicts, persistSyncCursor, persistSyncSnapshotCursor, prepareInitialSyncUpload,
  readData, readPendingSyncMutations, recordSyncConflict, writeData } from "../lib/storage.ts";

const today = "2026-10-20";
const at = minutes => new Date(Date.parse("2026-10-20T12:00:00.000Z") + minutes * 60_000);

function mockD1() {
  const db = new DatabaseSync(":memory:");
  return { db,
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; }, first() { return db.prepare(sql).get(...values) ?? null; },
        all() { return { results: db.prepare(sql).all(...values) }; }, run() { return db.prepare(sql).run(...values); },
        _sql: sql, _values: () => values };
    },
    batch(statements) {
      db.exec("BEGIN");
      try { for (const statement of statements) db.prepare(statement._sql).run(...statement._values()); db.exec("COMMIT"); return Promise.resolve([]); }
      catch (error) { db.exec("ROLLBACK"); return Promise.reject(error); }
    }
  };
}

/** One account on the real sync server, with each device keeping its own IndexedDB like a separate browser. */
async function account() {
  const d1 = mockD1();
  for (const migration of ["0001_sync.sql", "0002_attachments.sql", "0003_attachment_reconciliation.sql", "0004_sessions_feeds_retention.sql", "0005_sync_retention_cursor.sql"]) {
    d1.db.exec(await readFile(resolve(import.meta.dirname, `../sync-migrations/${migration}`), "utf8"));
  }
  const codec = new SyncCursorCodec(Buffer.alloc(32, 17).toString("base64url"));
  const store = new D1SyncStore(d1, codec, 10_000);
  const registry = new DeviceRegistry(d1, codec);
  const auth = { authenticate: async () => ({ issuer: "https://identity.example.test/", subject: "liam" }) };
  const fetcher = async (input, init) => {
    const request = new Request(`https://sync.example.test${input}`, init);
    if (String(input).includes("auth/session")) return Response.json({ authenticated: true, accountKey: "a".repeat(43) });
    if (String(input).includes("/devices")) return handleDeviceRequest(request, auth, registry);
    if (String(input).includes("/snapshot")) return handleSyncSnapshotRequest(request, auth, store);
    return handleSyncRequest(request, auth, store);
  };
  const outbox = { bindAccount: bindSyncAccount, prepareUpload: prepareInitialSyncUpload, pending: readPendingSyncMutations,
    acknowledge: acknowledgeSyncMutation, recordConflict: recordSyncConflict, cursor: getSyncCursor, setCursor: persistSyncCursor,
    snapshotCursor: getSyncSnapshotCursor, setSnapshotCursor: persistSyncSnapshotCursor, applyRemote: applyRemoteSyncChanges,
    hasConflicts: hasSyncConflicts, resolveConflicts: async () => (await autoResolveSyncConflicts()).resolved > 0 };
  const original = globalThis.indexedDB;
  const device = () => {
    const storage = new IDBFactory();
    const client = new SyncClient({ fetcher, outbox, deviceId: crypto.randomUUID(), online: () => true });
    // Devices take turns: storage helpers use the global IndexedDB, so each step switches to this device's copy.
    const onDevice = async work => { globalThis.indexedDB = storage; return work(); };
    return {
      sync: () => onDevice(async () => { await client.syncNow(); assert.equal(client.getStatus().state, "idle", JSON.stringify(client.getStatus())); }),
      edit: change => onDevice(async () => { const data = await readData(today); await writeData({ ...change(data), generation: data.generation + 1 }, data.generation); }),
      read: () => onDevice(() => readData(today)),
      dispose: () => client.dispose()
    };
  };
  return { device, close() { globalThis.indexedDB = original; d1.db.close(); } };
}

const newTask = (title, stamp = at(0)) => ({ ...newEntity(stamp), title, notes: "", priority: "low", tagIds: [], sortKey: stamp.getTime() });
const live = data => data.tasks.filter(task => !task.deletedAt);
const titles = data => live(data).map(task => task.title).sort();

test("tasks created on one device appear on the other, and completions replicate back", async () => {
  const server = await account();
  const phone = server.device();
  const laptop = server.device();
  try {
    await phone.sync(); await laptop.sync();
    const groceries = newTask("Buy groceries");
    await phone.edit(data => saveTask(data, groceries, "", today));
    await phone.sync();
    await laptop.sync();
    assert.deepEqual(titles(await laptop.read()), ["Buy groceries"]);

    await laptop.edit(data => completeTask(data, groceries.id, at(5)));
    await laptop.sync();
    await phone.sync();
    const onPhone = await phone.read();
    assert.equal(onPhone.tasks.find(task => task.id === groceries.id).completedAt, at(5).toISOString());
    assert.equal(onPhone.completions.filter(item => item.taskId === groceries.id).length, 1);
  } finally { phone.dispose(); laptop.dispose(); server.close(); }
});

test("tasks created offline on both devices end up on both, with no duplicates", async () => {
  const server = await account();
  const phone = server.device();
  const laptop = server.device();
  try {
    await phone.sync(); await laptop.sync();
    await phone.edit(data => saveTask(data, newTask("From phone"), "", today));
    await laptop.edit(data => saveTask(data, newTask("From laptop"), "", today));
    await phone.sync(); await laptop.sync(); await phone.sync();
    assert.deepEqual(titles(await phone.read()), ["From laptop", "From phone"]);
    assert.deepEqual(titles(await laptop.read()), ["From laptop", "From phone"]);
  } finally { phone.dispose(); laptop.dispose(); server.close(); }
});

test("concurrent edits converge automatically on the newest edit and never block other changes", async () => {
  const server = await account();
  const phone = server.device();
  const laptop = server.device();
  try {
    const shared = newTask("Plan trip");
    await phone.edit(data => saveTask(data, shared, "", today));
    await phone.sync(); await laptop.sync();

    // Both edit offline; the laptop edit is newer but syncs second, alongside a brand-new task.
    await phone.edit(data => saveTask(data, { ...shared, title: "Plan trip (phone)", updatedAt: at(10).toISOString(), revision: 2 }, "", today));
    await laptop.edit(data => saveTask(data, { ...shared, title: "Plan trip (laptop)", updatedAt: at(20).toISOString(), revision: 2 }, "", today));
    await laptop.edit(data => saveTask(data, newTask("Book hotel"), "", today));
    await phone.sync();
    await laptop.sync();
    await phone.sync();

    for (const data of [await phone.read(), await laptop.read()]) {
      assert.deepEqual(titles(data), ["Book hotel", "Plan trip (laptop)"]);
    }
  } finally { phone.dispose(); laptop.dispose(); server.close(); }
});

test("an offline edit survives a deletion on another device so no work is lost", async () => {
  const server = await account();
  const phone = server.device();
  const laptop = server.device();
  try {
    const shared = newTask("Renew passport");
    await phone.edit(data => saveTask(data, shared, "", today));
    await phone.sync(); await laptop.sync();

    await phone.edit(data => ({ ...data, tasks: data.tasks.map(task => task.id === shared.id
      ? { ...task, deletedAt: at(30).toISOString(), revision: task.revision + 1 } : task) }));
    await laptop.edit(data => saveTask(data, { ...shared, title: "Renew passport by Friday", updatedAt: at(10).toISOString(), revision: 2 }, "", today));
    await phone.sync(); await laptop.sync(); await phone.sync();

    for (const data of [await phone.read(), await laptop.read()]) assert.deepEqual(titles(data), ["Renew passport by Friday"]);
  } finally { phone.dispose(); laptop.dispose(); server.close(); }
});

test("a deletion replicates when nobody else edited the task", async () => {
  const server = await account();
  const phone = server.device();
  const laptop = server.device();
  try {
    const shared = newTask("Old idea");
    await phone.edit(data => saveTask(data, shared, "", today));
    await phone.sync(); await laptop.sync();
    await laptop.edit(data => ({ ...data, tasks: data.tasks.map(task => task.id === shared.id
      ? { ...task, deletedAt: at(5).toISOString(), revision: task.revision + 1 } : task) }));
    await laptop.sync(); await phone.sync();
    assert.deepEqual(titles(await phone.read()), []);
  } finally { phone.dispose(); laptop.dispose(); server.close(); }
});
