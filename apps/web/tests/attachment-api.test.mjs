import test from "node:test";
import assert from "node:assert/strict";
import { handleAttachmentRequest, MAX_ATTACHMENT_BYTES } from "../lib/attachment-api.ts";

const taskId = "4fef5e72-f114-4ea5-8d40-9d8069654f40";
const uploadId = "4e731b4e-c82c-4df6-a26a-847a2c115414";
const attachmentId = "c9d2d7c8-25eb-4f11-9f2d-f10540764b9a";
const principal = { issuer: "https://identity.test/", subject: "account-a" };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function fixture() {
  const calls = [];
  const record = { id: attachmentId, taskId, fileName: "my photo.png", mediaType: "image/png", size: png.length,
    sha256: "a".repeat(64), createdAt: "2026-10-03T12:00:00.000Z" };
  const auth = { async authenticate(request) { return request.headers.get("Authorization") === "Bearer ok" ? principal : undefined; } };
  const store = {
    async list(user) { calls.push(["list", user]); return [record]; },
    async upload(user, input) { calls.push(["upload", user, input]); return record; },
    async download(user, id) { calls.push(["download", user, id]); return id === attachmentId ? { metadata: record, body: new Blob([png]).stream() } : undefined; },
    async remove(user, id) { calls.push(["remove", user, id]); return id === attachmentId; }
  };
  const request = (path, init = {}) => new Request(`https://app.test/api/v1/attachments${path}`, {
    ...init, headers: { Authorization: "Bearer ok", ...(init.headers ?? {}) }
  });
  return { calls, auth, store, request };
}

test("attachment API authenticates before listing and keeps responses private", async () => {
  const f = fixture();
  const unauthorized = await handleAttachmentRequest(new Request("https://app.test/api/v1/attachments"), f.auth, f.store);
  assert.equal(unauthorized.status, 401);
  assert.equal(f.calls.length, 0);
  const response = await handleAttachmentRequest(f.request(""), f.auth, f.store);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(f.calls[0], ["list", principal]);
});

test("upload checks type, size, filename and idempotency metadata before storage", async () => {
  const f = fixture();
  const headers = { "Content-Type": "image/png", "X-LTM-Task-Id": taskId, "Idempotency-Key": uploadId,
    "X-LTM-File-Name": "my%20photo.png" };
  const ok = await handleAttachmentRequest(f.request("", { method: "POST", headers, body: png }), f.auth, f.store);
  assert.equal(ok.status, 201);
  assert.deepEqual(f.calls[0][2].bytes, png);
  assert.equal(f.calls[0][2].fileName, "my photo.png");
  assert.equal(f.calls[0][2].sha256.length, 64);
  const mismatch = await handleAttachmentRequest(f.request("", { method: "POST", headers: { ...headers, "Content-Type": "application/pdf" }, body: png }), f.auth, f.store);
  assert.equal(mismatch.status, 415);
  const tooLarge = await handleAttachmentRequest(f.request("", { method: "POST", headers: { ...headers, "Content-Length": String(MAX_ATTACHMENT_BYTES + 1) }, body: png }), f.auth, f.store);
  assert.equal(tooLarge.status, 413);
  assert.equal(f.calls.length, 1);
});

test("download and delete are scoped to authenticated account and do not reveal storage keys", async () => {
  const f = fixture();
  const downloaded = await handleAttachmentRequest(f.request(`/${attachmentId}`), f.auth, f.store);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("Content-Type"), "image/png");
  assert.equal(downloaded.headers.get("Content-Security-Policy"), "sandbox");
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), png);
  const removed = await handleAttachmentRequest(f.request(`/${attachmentId}`, { method: "DELETE" }), f.auth, f.store);
  assert.equal(removed.status, 200);
  assert.deepEqual(f.calls.map(call => call[0]), ["download", "remove"]);
  assert.equal((await handleAttachmentRequest(f.request("/bad"), f.auth, f.store)).status, 404);
});
