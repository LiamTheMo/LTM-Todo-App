import test from "node:test";
import assert from "node:assert/strict";
import { handleSyncRequest } from "../lib/sync-api.ts";
import { SyncRateLimitError } from "../lib/sync-api.ts";

const taskId = "4fef5e72-f114-4ea5-8d40-9d8069654f40";
const mutationId = "4e731b4e-c82c-4df6-a26a-847a2c115414";
const stamp = "2026-10-03T12:00:00.000Z";
const input = { protocolVersion: 1, mutations: [{ entityType: "tasks", entityId: taskId, baseRevision: 0,
  operation: "upsert", clientMutationId: mutationId, clientSchemaVersion: 4, payload: { id: taskId, title: "Private",
    notes: "", priority: "low", tagIds: [], sortKey: 0, createdAt: stamp, updatedAt: stamp, revision: 1 } }] };

function dependencies(accountId) {
  const calls = [];
  return {
    calls,
    auth: { async authenticate(request) { return request.headers.get("Authorization") === `Bearer ${accountId}` ?
      { issuer: "https://identity.test/", subject: accountId } : undefined; } },
    store: {
      async push(principal, batch) { calls.push(["push", principal, batch]); return { protocolVersion: 1, entitySchemaVersion: 4, results: [] }; },
      async pull(principal, cursor, limit) { calls.push(["pull", principal, cursor, limit]); return { protocolVersion: 1, entitySchemaVersion: 4, changes: [], hasMore: false }; }
    }
  };
}

test("requires an authenticated principal before touching the sync store", async () => {
  const deps = dependencies("account-a");
  const response = await handleSyncRequest(new Request("https://app.test/api/v1/sync/changes"), deps.auth, deps.store);
  assert.equal(response.status, 401);
  assert.equal(deps.calls.length, 0);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("passes only the authenticated account to the store and never accepts a client account ID", async () => {
  const deps = dependencies("account-a");
  const response = await handleSyncRequest(new Request("https://app.test/api/v1/sync/push", {
    method: "POST", headers: { Authorization: "Bearer account-a", "Content-Type": "application/json", "X-LTM-Sync-Protocol": "1" },
    body: JSON.stringify({ ...input, accountId: "account-b" })
  }), deps.auth, deps.store);
  assert.equal(response.status, 400);
  assert.equal(deps.calls.length, 0);
  const accepted = await handleSyncRequest(new Request("https://app.test/api/v1/sync/push", {
    method: "POST", headers: { Authorization: "Bearer account-a", "Content-Type": "application/json", "X-LTM-Sync-Protocol": "1" }, body: JSON.stringify(input)
  }), deps.auth, deps.store);
  assert.equal(accepted.status, 200);
  assert.deepEqual(deps.calls[0][1], { issuer: "https://identity.test/", subject: "account-a" });
});

test("validates methods and content type before mutation handling", async () => {
  const deps = dependencies("account-a");
  assert.equal((await handleSyncRequest(new Request("https://app.test/api/v1/sync/push"), deps.auth, deps.store)).status, 405);
  const response = await handleSyncRequest(new Request("https://app.test/api/v1/sync/push", {
    method: "POST", headers: { Authorization: "Bearer account-a", "Content-Type": "text/plain", "X-LTM-Sync-Protocol": "1" }, body: "{}"
  }), deps.auth, deps.store);
  assert.equal(response.status, 415);
  assert.equal(deps.calls.length, 0);
});

test("bounds the body and returns generic service failures", async () => {
  const deps = dependencies("account-a");
  const tooLarge = await handleSyncRequest(new Request("https://app.test/api/v1/sync/push", {
    method: "POST", headers: { Authorization: "Bearer account-a", "Content-Type": "application/json", "Content-Length": "1000001", "X-LTM-Sync-Protocol": "1" }, body: "{}"
  }), deps.auth, deps.store);
  assert.equal(tooLarge.status, 413);
  const downAuth = { async authenticate() { throw new Error("provider secret detail"); } };
  const unavailable = await handleSyncRequest(new Request("https://app.test/api/v1/sync/changes"), downAuth, deps.store);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "authentication_unavailable" });
});

test("passes a validated opaque cursor and bounded limit to account-scoped pull", async () => {
  const deps = dependencies("account-a");
  const response = await handleSyncRequest(new Request("https://app.test/api/v1/sync/changes?cursor=cursor_1&limit=12", {
    headers: { Authorization: "Bearer account-a", "X-LTM-Sync-Protocol": "1" }
  }), deps.auth, deps.store);
  assert.equal(response.status, 200);
  assert.deepEqual(deps.calls[0], ["pull", { issuer: "https://identity.test/", subject: "account-a" }, "cursor_1", 12]);
});

test("caps serialized response bodies to a fixed upper bound", async () => {
  const deps = dependencies("account-a");
  deps.store.pull = async () => ({ protocolVersion: 1, entitySchemaVersion: 4, changes: [{
    entityType: "tasks", entityId: taskId, revision: 1, updatedAt: stamp, payload: { id: taskId, title: "x".repeat(2_100_000) }
  }], hasMore: false });
  const response = await handleSyncRequest(new Request("https://app.test/api/v1/sync/changes?limit=1", {
    headers: { Authorization: "Bearer account-a", "X-LTM-Sync-Protocol": "1" }
  }), deps.auth, deps.store);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "sync_unavailable" });
  assert.ok(Number(response.headers.get("Content-Length") ?? 0) < 100);
});


test("returns an explicit retry interval for an account rate limit", async () => {
  const deps = dependencies("account-a");
  deps.store.push = async () => { throw new SyncRateLimitError(); };
  const response = await handleSyncRequest(new Request("https://app.test/api/v1/sync/push", {
    method: "POST", headers: { Authorization: "Bearer account-a", "Content-Type": "application/json", "X-LTM-Sync-Protocol": "1" },
    body: JSON.stringify(input)
  }), deps.auth, deps.store);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
});
