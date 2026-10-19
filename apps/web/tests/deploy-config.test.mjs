import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerSecrets, productionDeployCommit, readDeployTarget, resolveD1DatabaseIds, injectBuiltD1DatabaseId, injectD1DatabaseId, injectBuiltD1DatabaseIds, injectD1DatabaseIds } from "../scripts/deploy-worker.mjs";

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
  assert.throws(() => buildWorkerSecrets({ ...base, OIDC_REDIRECT_URI: "https://todo.example.test/api/v1/auth/callback?x=1" }), /HTTPS/);
});

test("omitted runtime secrets are not uploaded so the Worker keeps its existing values", () => {
  assert.deepEqual(buildWorkerSecrets({}), {});
  assert.deepEqual(buildWorkerSecrets({ AUTH_SESSION_SECRET: "", OIDC_CLIENT_SECRET: "  ", OIDC_CLIENT_ID: "ltm-client" }), { OIDC_CLIENT_ID: "ltm-client" });
  assert.throws(() => buildWorkerSecrets({ SYNC_CURSOR_SECRET: "weak" }), /SYNC_CURSOR_SECRET/);
});

test("production deploys only for a merged same-repository version-branch pull request into main", () => {
  const sha = "a".repeat(40);
  const environment = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "owner/app" };
  const event = { action: "closed", pull_request: { merged: true, merge_commit_sha: sha,
    base: { ref: "main" }, head: { ref: "v3.04", repo: { full_name: "owner/app" } } } };
  assert.equal(productionDeployCommit(environment, event), sha);
  const rejected = [
    [{ ...environment, GITHUB_ACTIONS: undefined }, event],
    [{ ...environment, GITHUB_EVENT_NAME: "push" }, event],
    [{ ...environment, GITHUB_EVENT_NAME: "workflow_dispatch" }, event],
    [environment, { ...event, action: "opened" }],
    [environment, { ...event, pull_request: { ...event.pull_request, merged: false } }],
    [environment, { ...event, pull_request: { ...event.pull_request, base: { ref: "v3.04" } } }],
    [environment, { ...event, pull_request: { ...event.pull_request, head: { ref: "fix/auth", repo: { full_name: "owner/app" } } } }],
    [environment, { ...event, pull_request: { ...event.pull_request, head: { ref: "v3.04", repo: { full_name: "fork/app" } } } }],
    [environment, { ...event, pull_request: { ...event.pull_request, merge_commit_sha: null } }],
    [environment, undefined]
  ];
  for (const [env, payload] of rejected) assert.throws(() => productionDeployCommit(env, payload), /vX\.XX pull request merges into main/);
});

test("deploy target trims pasted secrets and names an invalid D1 ID without echoing it", () => {
  const base = { CLOUDFLARE_API_TOKEN: " token\n", CLOUDFLARE_ACCOUNT_ID: `${"0123456789abcdef".repeat(2)}\n`,
    D1_DATABASE_ID: ` ${productionId}\n`, SYNC_D1_DATABASE_ID: `${syncProductionId}\r\n` };
  assert.deepEqual(readDeployTarget(base), { apiToken: "token", accountId: "0123456789abcdef".repeat(2),
    databaseId: productionId, syncDatabaseId: syncProductionId });
  assert.throws(() => readDeployTarget({ ...base, SYNC_D1_DATABASE_ID: "ltm-todo-sync" }),
    error => /^SYNC_D1_DATABASE_ID must be the database's 36-character UUID.*got 13 characters/.test(error.message) && !error.message.includes("ltm-todo-sync"));
  assert.equal(readDeployTarget({ ...base, D1_DATABASE_ID: `"${productionId}"` }).databaseId, productionId);
  assert.throws(() => readDeployTarget({ ...base, D1_DATABASE_ID: `${productionId}x` }), /D1_DATABASE_ID must be .*got 37 characters/);
  assert.throws(() => readDeployTarget({ ...base, SYNC_D1_DATABASE_ID: productionId }), /must be different databases/);
  assert.throws(() => readDeployTarget({ ...base, CLOUDFLARE_ACCOUNT_ID: productionId }), /CLOUDFLARE_ACCOUNT_ID must be/);
  assert.throws(() => readDeployTarget({ ...base, CLOUDFLARE_API_TOKEN: "  " }), /CLOUDFLARE_API_TOKEN\./);
});

test("D1 IDs are optional and resolve by configured database name", () => {
  const credentials = { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef".repeat(2) };
  assert.deepEqual(readDeployTarget(credentials), { apiToken: "token", accountId: "0123456789abcdef".repeat(2), databaseId: "", syncDatabaseId: "" });
  const built = JSON.stringify({ d1_databases: [
    { binding: "DB", database_name: "ltm-todo-notifications", database_id: placeholder },
    { binding: "SYNC_DB", database_name: "ltm-todo-sync", database_id: syncPlaceholder }] });
  const list = `proxy warning\n${JSON.stringify([
    { uuid: syncProductionId, name: "ltm-todo-sync" }, { uuid: productionId, name: "ltm-todo-notifications" },
    { uuid: "e3456789-90ab-4def-8123-456789abcdef", name: "ltm-todo-sync-staging" }])}`;
  assert.deepEqual(resolveD1DatabaseIds(list, built), { databaseId: productionId, syncDatabaseId: syncProductionId });
  assert.throws(() => resolveD1DatabaseIds(JSON.stringify([{ uuid: productionId, name: "ltm-todo-notifications" }]), built), /named ltm-todo-sync/);
  assert.throws(() => resolveD1DatabaseIds("not json", built), /D1 database list/);
});
