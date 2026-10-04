import { spawnSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(appRoot, "wrangler.jsonc");
const builtConfigPath = path.join(appRoot, "dist/server/wrangler.json");
const idPlaceholder = "00000000-0000-4000-8000-000000000001";
const syncIdPlaceholder = "00000000-0000-4000-8000-000000000002";
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function injectD1DatabaseId(configText, databaseId) {
  if (!idPattern.test(databaseId)) throw new Error("D1_DATABASE_ID must be a UUID.");
  const placeholder = `"database_id": "${idPlaceholder}"`;
  if (configText.split(placeholder).length !== 2) {
    throw new Error("Could not find exactly one D1 database ID placeholder in wrangler.jsonc.");
  }
  return configText.replace(placeholder, `"database_id": "${databaseId}"`);
}

export function injectBuiltD1DatabaseId(configText, databaseId) {
  if (!idPattern.test(databaseId)) throw new Error("D1_DATABASE_ID must be a UUID.");
  const config = JSON.parse(configText);
  const bindings = config.d1_databases?.filter(binding => binding.binding === "DB") ?? [];
  if (bindings.length !== 1 || bindings[0].database_id !== idPlaceholder) {
    throw new Error("The built Worker config does not contain exactly one expected D1 placeholder.");
  }
  bindings[0].database_id = databaseId;
  return JSON.stringify(config);
}

export function injectD1DatabaseIds(configText, notificationsId, syncId) {
  if (!idPattern.test(notificationsId) || !idPattern.test(syncId)) throw new Error("Both D1 database IDs must be UUIDs.");
  const notificationsPlaceholder = new RegExp(`("database_id"\\s*:\\s*")${idPlaceholder}(")`, "g");
  const syncPlaceholder = new RegExp(`("database_id"\\s*:\\s*")${syncIdPlaceholder}(")`, "g");
  if ([...configText.matchAll(notificationsPlaceholder)].length !== 1 || [...configText.matchAll(syncPlaceholder)].length !== 1) {
    throw new Error("Could not find exactly one placeholder for each D1 database in wrangler.jsonc.");
  }
  return configText.replace(notificationsPlaceholder, `$1${notificationsId}$2`).replace(syncPlaceholder, `$1${syncId}$2`);
}

export function injectBuiltD1DatabaseIds(configText, notificationsId, syncId) {
  if (!idPattern.test(notificationsId) || !idPattern.test(syncId)) throw new Error("Both D1 database IDs must be UUIDs.");
  const config = JSON.parse(configText);
  const bindings = config.d1_databases ?? [];
  const notifications = bindings.filter(binding => binding.binding === "DB");
  const sync = bindings.filter(binding => binding.binding === "SYNC_DB");
  if (notifications.length !== 1 || notifications[0].database_id !== idPlaceholder ||
      sync.length !== 1 || sync[0].database_id !== syncIdPlaceholder) {
    throw new Error("The built Worker config does not contain exactly one expected placeholder for each D1 binding.");
  }
  notifications[0].database_id = notificationsId;
  sync[0].database_id = syncId;
  return JSON.stringify(config);
}

function runWrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { cwd: appRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler exited with status ${result.status ?? "unknown"}.`);
}

export function buildWorkerSecrets(environment) {
  const required = ["VAPID_PRIVATE_KEY", "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URI", "OIDC_CLIENT_ID",
    "OIDC_REDIRECT_URI", "AUTH_SESSION_SECRET", "SYNC_CURSOR_SECRET", "ICS_FEED_ENCRYPTION_KEY"];
  const missing = required.filter(name => typeof environment[name] !== "string" || !environment[name].trim());
  if (missing.length) throw new Error(`Set the required Cloudflare Workers Builds secrets: ${missing.join(", ")}.`);
  const vapid = environment.VAPID_PRIVATE_KEY.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(vapid) || Buffer.from(vapid, "base64url").byteLength !== 32) {
    throw new Error("VAPID_PRIVATE_KEY must be a 32-byte base64url P-256 private key.");
  }
  for (const name of ["AUTH_SESSION_SECRET", "SYNC_CURSOR_SECRET", "ICS_FEED_ENCRYPTION_KEY"]) {
    const value = environment[name];
    if (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, "base64url").byteLength !== 32) {
      throw new Error(`${name} must be an independently generated 32-byte base64url value.`);
    }
  }
  for (const name of ["OIDC_ISSUER", "OIDC_JWKS_URI", "OIDC_REDIRECT_URI"]) {
    let url;
    try { url = new URL(environment[name]); }
    catch { throw new Error(`${name} must be a valid HTTPS URL.`); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        name !== "OIDC_REDIRECT_URI" && url.search) throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  const callback = new URL(environment.OIDC_REDIRECT_URI);
  if (callback.pathname !== "/api/v1/auth/callback" || callback.search || callback.hash || callback.username || callback.password) {
    throw new Error("OIDC_REDIRECT_URI must end at /api/v1/auth/callback without query or fragment parameters.");
  }
  const secrets = Object.fromEntries(required.map(name => [name, environment[name].trim()]));
  if (environment.OIDC_CLIENT_SECRET?.trim()) secrets.OIDC_CLIENT_SECRET = environment.OIDC_CLIENT_SECRET.trim();
  return secrets;
}

async function deploy() {
  if (process.env.WORKERS_CI !== "1" || process.env.WORKERS_CI_BRANCH !== "main") {
    throw new Error("Production deployment is restricted to the main-branch Cloudflare Workers Build.");
  }
  const databaseId = process.env.D1_DATABASE_ID ?? "";
  const syncDatabaseId = process.env.SYNC_D1_DATABASE_ID ?? "";
  if (!databaseId || !syncDatabaseId) {
    throw new Error("Set D1_DATABASE_ID and SYNC_D1_DATABASE_ID in Cloudflare Workers Builds.");
  }
  const workerSecrets = buildWorkerSecrets(process.env);

  const originalBuiltConfig = await readFile(builtConfigPath, "utf8");
  const sourceConfig = await readFile(configPath, "utf8");
  const migrationConfigPath = path.join(appRoot, `.wrangler.deploy-${process.pid}.jsonc`);
  const secretsPath = path.join(appRoot, `.wrangler.secrets-${process.pid}.json`);
  let builtConfigUpdated = false;

  try {
    const injectedSourceConfig = injectD1DatabaseIds(sourceConfig, databaseId, syncDatabaseId);
    await writeFile(migrationConfigPath, injectedSourceConfig, { mode: 0o600 });

    const deployedBuiltConfig = injectBuiltD1DatabaseIds(originalBuiltConfig, databaseId, syncDatabaseId);
    await writeFile(builtConfigPath, deployedBuiltConfig, { mode: 0o600 });
    builtConfigUpdated = true;
    await writeFile(secretsPath, JSON.stringify(workerSecrets), { mode: 0o600 });

    runWrangler(["d1", "migrations", "apply", "ltm-todo-notifications", "--remote", "--config", migrationConfigPath]);
    runWrangler(["d1", "migrations", "apply", "ltm-todo-sync", "--remote", "--config", migrationConfigPath]);
    runWrangler(["deploy", "--config", builtConfigPath, "--secrets-file", secretsPath]);
  } finally {
    await Promise.all([
      unlink(migrationConfigPath).catch(() => undefined),
      unlink(secretsPath).catch(() => undefined),
      builtConfigUpdated ? writeFile(builtConfigPath, originalBuiltConfig) : Promise.resolve()
    ]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deploy().catch(error => {
    console.error(error instanceof Error ? error.message : "Cloudflare deployment failed.");
    process.exitCode = 1;
  });
}
