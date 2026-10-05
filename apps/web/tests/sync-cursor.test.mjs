import test from "node:test";
import assert from "node:assert/strict";
import { SyncCursorCodec } from "../lib/sync-cursor.ts";

const secret = Buffer.alloc(32, 7).toString("base64url");

test("issues unreadable, authenticated account-scoped cursors", async () => {
  const codec = new SyncCursorCodec(secret, () => 1_800_000_000_000);
  const cursor = await codec.encode("account-a", 42);
  assert.match(cursor, /^v1\./);
  assert.equal(await codec.decode(cursor, "account-a"), 42);
  await assert.rejects(() => codec.decode(cursor, "account-b"), /Invalid sync cursor/);
});

test("rejects modified, malformed, and expired cursor values", async () => {
  let now = 1_800_000_000_000;
  const codec = new SyncCursorCodec(secret, () => now);
  const cursor = await codec.encode("account-a", 9, 60_000);
  const encoded = cursor.slice(3);
  const tampered = `v1.${encoded[0] === "A" ? "B" : "A"}${encoded.slice(1)}`;
  await assert.rejects(() => codec.decode(tampered, "account-a"), /Invalid sync cursor/);
  now += 60_000;
  await assert.rejects(() => codec.decode(cursor, "account-a"), /Invalid sync cursor/);
  await assert.rejects(() => codec.decode("garbage", "account-a"), /Invalid sync cursor/);
});

test("requires a cryptographic cursor secret of exactly 32 bytes", () => {
  assert.throws(() => new SyncCursorCodec(Buffer.alloc(16, 1).toString("base64url")), /32 bytes/);
});

test("snapshot order migration rejects old continuations so the client restarts safely", async () => {
  const codec = new SyncCursorCodec(secret);
  const cursor = await codec.encodeSnapshot({ accountId: "account-a", sequence: 5, entityType: "tasks", entityId: "task-a" });
  assert.match(cursor, /^s2\./);
  assert.equal((await codec.decodeSnapshot(cursor, "account-a")).entityType, "tasks");
  await assert.rejects(() => codec.decodeSnapshot(cursor.replace(/^s2\./, "s1."), "account-a"), /Invalid snapshot cursor/);
});
