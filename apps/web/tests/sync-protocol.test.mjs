import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { MAX_SYNC_BATCH, MAX_SYNC_ENTITY_BYTES, parseSyncPullQuery, parseSyncPushBatch } from "../lib/sync-protocol.ts";

const id = "4fef5e72-f114-4ea5-8d40-9d8069654f40";
const mutationId = "4e731b4e-c82c-4df6-a26a-847a2c115414";
const stamp = "2026-10-03T12:00:00.000Z";
const validMutation = (overrides = {}) => ({
  entityType: "tasks", entityId: id, baseRevision: 0, operation: "upsert", clientMutationId: mutationId,
  clientSchemaVersion: 4, payload: { id, title: "Test", notes: "", priority: "low", tagIds: [], sortKey: 0,
    createdAt: stamp, updatedAt: stamp, revision: 1 }, ...overrides
});

test("accepts a versioned, bounded sync mutation", () => {
  const result = parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation()] });
  assert.equal(result.ok, true);
  assert.equal(result.value.mutations[0].entityId, id);
});

test("accepts legacy no-priority values from older clients", () => {
  const payload = { ...validMutation().payload, priority: "none" };
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ payload })] }).ok, true);
});

test("shared valid and invalid fixtures conform to the runtime protocol parser", () => {
  const root = resolve(import.meta.dirname, "../../../shared/fixtures");
  const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../shared/schemas/sync-v1.schema.json"), "utf8"));
  const valid = JSON.parse(readFileSync(resolve(root, "sync-v1.valid.json"), "utf8"));
  const invalid = JSON.parse(readFileSync(resolve(root, "sync-v1.invalid.json"), "utf8"));
  assert.equal(parseSyncPushBatch(valid).ok, true);
  assert.equal(parseSyncPushBatch(invalid).ok, false);
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  assert.equal(validate(invalid), false);
});

test("rejects unsupported protocols before accepting mutations", () => {
  const result = parseSyncPushBatch({ protocolVersion: 2, mutations: [] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_protocol");
  const oldSchema = parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ clientSchemaVersion: 3 })] });
  assert.equal(oldSchema.ok, false);
  assert.equal(oldSchema.code, "unsupported_schema");
});

test("rejects forged identities, invalid revisions, duplicate mutations, and repeated entities", () => {
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ entityId: "not-a-uuid" })] }).ok, false);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ baseRevision: -1 })] }).ok, false);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation(), validMutation()] }).ok, false);
  const repeated = validMutation({ clientMutationId: "0b3a6548-3933-4edc-bfab-a2b8dce1d20b" });
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation(), repeated] }).ok, false);
});

test("requires a matching payload identity and a supported entity type", () => {
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ payload: { id: "4e731b4e-c82c-4df6-a26a-847a2c115414" } })] }).ok, false);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ entityType: "accounts" })] }).ok, false);
});

test("accepts schema-v4 calendar colors and saved-view date scopes but rejects removed task fields", () => {
  const entityFields = { createdAt: stamp, updatedAt: stamp, revision: 1 };
  const calendar = validMutation({ entityType: "calendars", payload: { id, ...entityFields, name: "Personal",
    color: "#2a8fc4", visible: true, sortKey: 0 } });
  const savedView = validMutation({ entityType: "savedViews", payload: { id, ...entityFields, name: "Overdue",
    query: "", dateScope: "overdue", priority: "all", completed: false } });
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [calendar] }).ok, true);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [savedView] }).ok, true);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ payload: {
    ...validMutation().payload, parentTaskId: "4fef5e72-f114-4ea5-8d40-9d8069654f40"
  } })] }).ok, false);
});

test("accepts content-free tombstones and rejects payloads on delete mutations", () => {
  const tombstone = validMutation({ operation: "delete" });
  delete tombstone.payload;
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [tombstone] }).ok, true);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ operation: "delete" })] }).ok, false);
});

test("bounds batches, entity payloads, and serialized request bodies", () => {
  const tooMany = Array.from({ length: MAX_SYNC_BATCH + 1 }, (_, index) => validMutation({
    entityId: `4fef5e72-f114-4ea5-8d40-9d8069654f${String(index).padStart(2, "0")}`,
    clientMutationId: `4e731b4e-c82c-4df6-a26a-847a2c1154${String(index).padStart(2, "0")}`
  }));
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: tooMany }).ok, false);
  const largePayload = validMutation({ payload: { id, title: "x".repeat(MAX_SYNC_ENTITY_BYTES) } });
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [largePayload] }).ok, false);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [] }, 1_000_001).code, "request_too_large");
});

test("rejects unsafe object keys and non-finite JSON values", () => {
  const unsafe = JSON.parse(`{"id":"${id}","constructor":{"prototype":{"polluted":true}}}`);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ payload: unsafe })] }).ok, false);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [validMutation({ payload: { id, score: Number.NaN } })] }).ok, false);
});

test("parses bounded opaque cursors and rejects duplicate or excessive paging parameters", () => {
  assert.deepEqual(parseSyncPullQuery(new URL("https://app.test/api/v1/sync/changes?cursor=abc_123&limit=12")), {
    ok: true, value: { cursor: "abc_123", limit: 12 }
  });
  assert.equal(parseSyncPullQuery(new URL("https://app.test/api/v1/sync/changes?limit=13")).ok, false);
  assert.equal(parseSyncPullQuery(new URL("https://app.test/api/v1/sync/changes?cursor=bad%2Fcursor")).ok, false);
  assert.equal(parseSyncPullQuery(new URL("https://app.test/api/v1/sync/changes?limit=2&limit=3")).ok, false);
});
