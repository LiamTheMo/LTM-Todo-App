import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { buildPushPayload } from "@block65/webcrypto-web-push";

function publicKey(keyPair) {
  const jwk = keyPair.publicKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
}

test("Web Push payload uses encrypted aes128gcm and a VAPID authorization header", async () => {
  const server = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const client = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateJwk = server.privateKey.export({ format: "jwk" });
  const result = await buildPushPayload({ data: JSON.stringify({ title: "Reminder" }), options: { ttl: 60 } }, {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    expirationTime: null,
    keys: { p256dh: publicKey(client), auth: randomBytes(16).toString("base64url") }
  }, {
    subject: "https://ltm-todo.example",
    publicKey: publicKey(server),
    privateKey: privateJwk.d
  });
  const headers = new Headers(result.headers);
  assert.equal(headers.get("Content-Encoding"), "aes128gcm");
  assert.match(headers.get("Authorization") ?? "", /^vapid t=.+, k=/);
  assert.ok(result.body instanceof Uint8Array);
  assert.ok(result.body.byteLength > 0);
});
