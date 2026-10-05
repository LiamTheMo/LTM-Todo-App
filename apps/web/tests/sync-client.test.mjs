import test from "node:test";
import assert from "node:assert/strict";
import { SyncClient } from "../lib/sync-client.ts";

const mutation = { entityType: "tasks", entityId: "4fef5e72-f114-4ea5-8d40-9d8069654f40", baseRevision: 0,
  operation: "upsert", clientMutationId: "4e731b4e-c82c-4df6-a26a-847a2c115414", clientSchemaVersion: 4,
  payload: { id: "4fef5e72-f114-4ea5-8d40-9d8069654f40", title: "Sync me" } };

function fixture(fetcher) {
  const calls = { acknowledged: [], conflicts: [], applied: [], cursors: [] };
  let hasConflicts = false;
  let pendingMutation = mutation;
  let storedCursor;
  let storedSnapshotCursor;
  const client = new SyncClient({ fetcher, online: () => true, deviceId: "4e731b4e-c82c-4df6-a26a-847a2c115414",
    now: () => Date.parse("2026-10-03T12:00:00Z"), random: () => 0.5, outbox: {
    bindAccount: async () => true,
    prepareUpload: async () => undefined,
    pending: async () => pendingMutation ? [pendingMutation] : [],
    acknowledge: async (...args) => { calls.acknowledged.push(args); pendingMutation = undefined; },
    recordConflict: async (...args) => { calls.conflicts.push(args); hasConflicts = true; },
    cursor: async () => storedCursor,
    setCursor: async cursor => { storedCursor = cursor; calls.cursors.push(cursor); },
    snapshotCursor: async () => storedSnapshotCursor,
    setSnapshotCursor: async cursor => { storedSnapshotCursor = cursor; },
    applyRemote: async changes => calls.applied.push(changes),
    hasConflicts: async () => hasConflicts
  } });
  return { client, calls };
}

test("default browser APIs retain their global receiver during session checks", async t => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let requests = 0;
  let scheduled = 0;
  let cleared = 0;
  t.mock.method(globalThis, "fetch", async function (input) {
    assert.equal(this, globalThis, "browser fetch must not receive the SyncClient as this");
    assert.equal(input, "/api/v1/auth/session");
    requests++;
    return Response.json({ authenticated: false });
  });
  t.mock.method(globalThis, "setTimeout", function (...args) {
    assert.equal(this, globalThis, "browser timers must retain their global receiver");
    scheduled++;
    return originalSetTimeout(...args);
  });
  t.mock.method(globalThis, "clearTimeout", function (...args) {
    assert.equal(this, globalThis);
    cleared++;
    return originalClearTimeout(...args);
  });
  const { client } = fixture();
  try {
    await client.syncNow();
    assert.equal(client.getStatus().state, "signed_out");
    assert.equal(requests, 1);
    assert.equal(scheduled, 1);
    assert.equal(cleared, 1);
  } finally { client.dispose(); }
});

test("sync checks session, pushes idempotent local mutations, then applies and checkpoints pull pages", async () => {
  const requests = [];
  const { client, calls } = fixture(async (input, init = {}) => {
    requests.push({ input: String(input), init });
    if (String(input).includes("auth/session")) return Response.json({ authenticated: true, accountKey: "a".repeat(43) });
    if (String(input).includes("sync/snapshot")) return Response.json({ protocolVersion: 1, entitySchemaVersion: 4,
      changes: [], complete: true, cursor: "snapshot-cursor" });
    if (String(input).includes("sync/push")) return Response.json({ protocolVersion: 1, entitySchemaVersion: 4,
      results: [{ clientMutationId: mutation.clientMutationId, status: "accepted", revision: 8, cursor: "opaque" }] });
    if (String(input).includes("/devices/")) return Response.json({ acknowledgedSequence: 0 });
    return Response.json({ protocolVersion: 1, entitySchemaVersion: 4, changes: [], cursor: "opaque-next", hasMore: false });
  });
  await client.syncNow();
  client.dispose();
  assert.match(requests[0].input, /auth\/session/);
  assert.equal(requests[1].input, "/api/v1/devices");
  assert.deepEqual(JSON.parse(requests[1].init.body), { deviceId: "4e731b4e-c82c-4df6-a26a-847a2c115414",
    displayName: "This browser", clientKind: "web" });
  assert.match(requests[2].input, /sync\/snapshot/);
  assert.match(requests[3].input, /devices\/4e731b4e-c82c-4df6-a26a-847a2c115414\/cursor/);
  assert.equal(requests[4].init.headers["X-LTM-Sync-Protocol"], "1");
  assert.equal(requests[4].init.headers["X-LTM-Sync-Device"], "4e731b4e-c82c-4df6-a26a-847a2c115414");
  assert.deepEqual(JSON.parse(requests[4].init.body).mutations, [mutation]);
  assert.equal(calls.acknowledged[0][1], 8);
  assert.deepEqual(calls.applied, [[], []]);
  assert.deepEqual(calls.cursors, ["snapshot-cursor", "opaque-next"]);
  assert.match(requests[6].input, /devices\/4e731b4e-c82c-4df6-a26a-847a2c115414\/cursor/);
  assert.deepEqual(JSON.parse(requests[6].init.body), { cursor: "opaque-next" });
  assert.equal(client.getStatus().state, "idle");
});

test("expired sessions stop without retrying protected sync endpoints", async () => {
  const requests = [];
  const { client } = fixture(async input => {
    requests.push(String(input));
    return Response.json({ authenticated: false });
  });
  await client.syncNow();
  client.dispose();
  assert.deepEqual(requests, ["/api/v1/auth/session"]);
  assert.equal(client.getStatus().state, "signed_out");
});

test("a retired browser stays blocked until the user explicitly re-registers it with a new ID", async () => {
  const registrations = [];
  const { client } = fixture(async (input, init = {}) => {
    const path = String(input);
    if (path.includes("auth/session")) return Response.json({ authenticated: true, accountKey: "a".repeat(43) });
    if (path === "/api/v1/devices") {
      const device = JSON.parse(init.body);
      registrations.push(device.deviceId);
      return registrations.length === 1 ? Response.json({ error: "device_retired" }, { status: 410 }) : Response.json({ device });
    }
    if (path.includes("sync/snapshot")) return Response.json({ protocolVersion: 1, entitySchemaVersion: 4,
      changes: [], complete: true, cursor: "snapshot-cursor" });
    if (path.includes("sync/push")) return Response.json({ protocolVersion: 1, entitySchemaVersion: 4,
      results: [{ clientMutationId: mutation.clientMutationId, status: "accepted", revision: 1, cursor: "push-cursor" }] });
    if (path.includes("/devices/")) return Response.json({ acknowledgedSequence: 1 });
    return Response.json({ protocolVersion: 1, entitySchemaVersion: 4, changes: [], cursor: "pull-cursor", hasMore: false });
  });
  await client.syncNow();
  assert.equal(client.getStatus().state, "device_retired");
  assert.equal(registrations.length, 1);
  await client.reRegisterRetiredDevice();
  client.dispose();
  assert.equal(registrations.length, 2);
  assert.notEqual(registrations[0], registrations[1]);
  assert.equal(client.getStatus().state, "idle");
});

test("revision conflicts are retained for local-first resolution and surfaced", async () => {
  const { client, calls } = fixture(async input => {
    if (String(input).includes("auth/session")) return Response.json({ authenticated: true, accountKey: "a".repeat(43) });
    if (String(input).includes("sync/snapshot")) return Response.json({ protocolVersion: 1, entitySchemaVersion: 4,
      changes: [], complete: true, cursor: "snapshot-cursor" });
    if (String(input).includes("sync/push")) return Response.json({ protocolVersion: 1, entitySchemaVersion: 4,
      results: [{ clientMutationId: mutation.clientMutationId, status: "conflict", current: { entityType: "tasks", entityId: mutation.entityId,
        revision: 4, updatedAt: "2026-10-03T12:00:00Z", payload: { ...mutation.payload, title: "Other device" } } }] });
    if (String(input).includes("/devices/")) return Response.json({ acknowledgedSequence: 0 });
    return Response.json({ protocolVersion: 1, entitySchemaVersion: 4, changes: [], cursor: "c", hasMore: false });
  });
  await client.syncNow();
  client.dispose();
  assert.equal(calls.conflicts.length, 1);
  assert.equal(calls.conflicts[0][1].payload.title, "Other device");
  assert.equal(client.getStatus().state, "conflict");
});

test("paused sync identifies the failed operation and fixed error code without leaking server content", async () => {
  for (const code of ["database_schema_missing", "raw private task title and token"]) {
    const { client } = fixture(async input => String(input).includes("auth/session")
      ? Response.json({ authenticated: true, accountKey: "a".repeat(43) })
      : Response.json({ error: code, detail: "secret user content" }, { status: 503 }));
    try {
      await client.syncNow();
      assert.equal(client.getStatus().state, "error");
      assert.equal(client.getStatus().authenticated, true);
      assert.deepEqual(client.getStatus().failure, { step: "device_registration", status: 503,
        code: code === "database_schema_missing" ? code : undefined });
      assert.doesNotMatch(JSON.stringify(client.getStatus()), /secret|private|token/);
    } finally { client.dispose(); }
  }
});
