import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerSecrets, injectBuiltD1DatabaseId, injectD1DatabaseId, injectBuiltD1DatabaseIds, injectD1DatabaseIds } from "../scripts/deploy-worker.mjs";

const placeholder = "00000000-0000-4000-8000-000000000001";
const productionId = "c1234567-89ab-4def-8123-456789abcdef";
const syncPlaceholder = "00000000-0000-4000-8000-000000000002";
const syncProductionId = "d2345678-90ab-4def-8123-456789abcdef";

test("D1 ID injection replaces only the deployment placeholder", () => {
  const config = `{"database_id": "${placeholder}", "other": "${placeholder}"}`;
  assert.equal(injectD1DatabaseId(config, productionId), `{"database_id": "${productionId}", "other": "${placeholder}"}`);
});

test("D1 ID injection rejects malformed IDs and missing or duplicate placeholders", () => {
  assert.throws(() => injectD1DatabaseId(`{"database_id": "${placeholder}"}`, "not-an-id"), /must be a UUID/);
  assert.throws(() => injectD1DatabaseId("{}", productionId), /exactly one/);
  assert.throws(() => injectD1DatabaseId(`{"a":"${placeholder}","b":"${placeholder}"}`, productionId), /exactly one/);
});

test("built Worker config receives the D1 ID without changing other bindings", () => {
  const input = JSON.stringify({
    d1_databases: [
      { binding: "DB", database_id: placeholder },
      { binding: "OTHER_DB", database_id: "other" }
    ]
  });
  assert.deepEqual(JSON.parse(injectBuiltD1DatabaseId(input, productionId)), {
    d1_databases: [
      { binding: "DB", database_id: productionId },
      { binding: "OTHER_DB", database_id: "other" }
    ]
  });
  assert.throws(() => injectBuiltD1DatabaseId("{}", productionId), /exactly one/);
});

test("deployment injects both notification and sync D1 database IDs", () => {
  const config = `{"d1_databases":[{"binding":"DB","database_id":"${placeholder}"},{"binding":"SYNC_DB","database_id":"${syncPlaceholder}"}]}`;
  assert.equal(injectD1DatabaseIds(config, productionId, syncProductionId),
    `{"d1_databases":[{"binding":"DB","database_id":"${productionId}"},{"binding":"SYNC_DB","database_id":"${syncProductionId}"}]}`);
  assert.deepEqual(JSON.parse(injectBuiltD1DatabaseIds(config, productionId, syncProductionId)).d1_databases.map(x => x.database_id),
    [productionId, syncProductionId]);
  assert.throws(() => injectD1DatabaseIds(config, productionId, "bad"), /UUIDs/);
});

test("production deploy packages all v3 runtime credentials as Worker secrets", () => {
  const secret = Buffer.alloc(32, 5).toString("base64url");
  const result = buildWorkerSecrets({
    VAPID_PRIVATE_KEY: secret,
    OIDC_ISSUER: "https://identity.example.test/",
    OIDC_AUDIENCE: "ltm-todo-app",
    OIDC_JWKS_URI: "https://identity.example.test/.well-known/jwks.json",
    OIDC_CLIENT_ID: "ltm-client",
    OIDC_REDIRECT_URI: "https://todo.example.test/api/v1/auth/callback",
    AUTH_SESSION_SECRET: secret,
    SYNC_CURSOR_SECRET: Buffer.alloc(32, 6).toString("base64url"),
    ICS_FEED_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    OIDC_CLIENT_SECRET: "provider-secret"
  });
  assert.equal(result.OIDC_ISSUER, "https://identity.example.test/");
  assert.equal(result.VAPID_PRIVATE_KEY, secret);
  assert.equal(result.OIDC_CLIENT_SECRET, "provider-secret");
  for (const name of ["AUTH_SESSION_SECRET", "SYNC_CURSOR_SECRET", "ICS_FEED_ENCRYPTION_KEY"]) assert.equal(Buffer.from(result[name], "base64url").byteLength, 32);
});

test("production deploy refuses missing, weak, non-HTTPS, or misrouted runtime configuration", () => {
  const secret = Buffer.alloc(32, 5).toString("base64url");
  const base = { VAPID_PRIVATE_KEY: secret, OIDC_ISSUER: "https://identity.example.test/", OIDC_AUDIENCE: "ltm",
    OIDC_JWKS_URI: "https://identity.example.test/keys", OIDC_CLIENT_ID: "ltm-client",
    OIDC_REDIRECT_URI: "https://todo.example.test/api/v1/auth/callback", AUTH_SESSION_SECRET: secret,
    SYNC_CURSOR_SECRET: Buffer.alloc(32, 6).toString("base64url"), ICS_FEED_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url") };
  assert.throws(() => buildWorkerSecrets({ ...base, AUTH_SESSION_SECRET: "weak" }), /32-byte/);
  assert.throws(() => buildWorkerSecrets({ ...base, OIDC_JWKS_URI: "http://identity.example.test/keys" }), /HTTPS/);
  assert.throws(() => buildWorkerSecrets({ ...base, OIDC_REDIRECT_URI: "https://todo.example.test/wrong" }), /callback/);
  assert.throws(() => buildWorkerSecrets({ ...base, ICS_FEED_ENCRYPTION_KEY: undefined }), /ICS_FEED_ENCRYPTION_KEY/);
});
