import test from "node:test";
import assert from "node:assert/strict";
import { syncPendingAttachmentUploads } from "../lib/attachment-client.ts";

const item = { id: "local-1", uploadId: "upload-1", taskId: "task-1", fileName: "notes.txt", mediaType: "text/plain", blob: new Blob(["notes"]), queuedAt: 1 };

function fixture() {
  const calls = [];
  const state = [item];
  return { calls, state, outbox: { async pending() { return [...state]; }, async acknowledge(id) { calls.push(["ack", id]); state.splice(0, state.length); }, async bindAccount() { return true; } } };
}

test("attachment retries reuse the stable idempotency key and acknowledge only after success", async () => {
  const f = fixture();
  let requestNumber = 0;
  const result = await syncPendingAttachmentUploads({ outbox: f.outbox, online: true, fetcher: async (_url, options) => {
    if (requestNumber++ === 0) return Response.json({ authenticated: true, accountKey: "account-key-123456789012345678901234" });
    f.calls.push(["fetch", options.headers["Idempotency-Key"], options.body]);
    return new Response("{}", { status: 201 });
  } });
  assert.deepEqual(result, { uploaded: 1, pending: 0 });
  assert.deepEqual(f.calls.map(call => call[0]), ["fetch", "ack"]);
  assert.equal(f.calls[0][1], "upload-1");
});

test("offline and expired-session queues remain durable without uploading", async () => {
  const offline = fixture();
  const noNetwork = await syncPendingAttachmentUploads({ outbox: offline.outbox, online: false, fetcher: async () => { throw new Error("must not fetch"); } });
  assert.deepEqual(noNetwork, { uploaded: 0, pending: 1, blocked: "offline" });
  const expired = await syncPendingAttachmentUploads({ outbox: offline.outbox, online: true, fetcher: async () => new Response("{}", { status: 401 }) });
  assert.deepEqual(expired, { uploaded: 0, pending: 1, blocked: "sign_in" });
  assert.equal(offline.state.length, 1);
});

test("partial service failure preserves unacknowledged attachment data", async () => {
  const f = fixture();
  let calls = 0;
  const result = await syncPendingAttachmentUploads({ outbox: f.outbox, online: true, fetcher: async () => calls++ === 0
    ? Response.json({ authenticated: true, accountKey: "account-key-123456789012345678901234" }) : new Response("{}", { status: 503 }) });
  assert.deepEqual(result, { uploaded: 0, pending: 1, blocked: "service" });
  assert.equal(f.state.length, 1);
});

test("an attachment queue cannot silently move to a different signed-in account", async () => {
  const f = fixture();
  f.outbox.bindAccount = async () => false;
  const result = await syncPendingAttachmentUploads({ outbox: f.outbox, online: true,
    fetcher: async () => Response.json({ authenticated: true, accountKey: "different-account-key-123456789012345678" }) });
  assert.deepEqual(result, { uploaded: 0, pending: 1, blocked: "account_mismatch" });
  assert.equal(f.state.length, 1);
});
