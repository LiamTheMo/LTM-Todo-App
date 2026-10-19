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
const versionBranchPattern = /^v[0-9]+\.[0-9]{2}$/;

/**
 * Reads the Cloudflare credentials and D1 IDs, trimming copy-paste whitespace and wrapping quotes. Errors name the secret and its shape but
 * never echo the value.
 */
export function readDeployTarget(environment) {
  const value = name => typeof environment[name] === "string" ? environment[name].trim().replace(/^(["'])(.*)\1$/s, "$2").trim() : "";
  const target = { apiToken: value("CLOUDFLARE_API_TOKEN"), accountId: value("CLOUDFLARE_ACCOUNT_ID"),
    databaseId: value("D1_DATABASE_ID"), syncDatabaseId: value("SYNC_D1_DATABASE_ID") };
  const missing = [["CLOUDFLARE_API_TOKEN", target.apiToken], ["CLOUDFLARE_ACCOUNT_ID", target.accountId],
    ["D1_DATABASE_ID", target.databaseId], ["SYNC_D1_DATABASE_ID", target.syncDatabaseId]].filter(([, item]) => !item).map(([name]) => name);
  if (missing.length) throw new Error(`Set these GitHub secrets for the production deploy: ${missing.join(", ")}.`);
  if (!/^[0-9a-f]{32}$/i.test(target.accountId)) {
    throw new Error(`CLOUDFLARE_ACCOUNT_ID must be the 32-character hex account ID (got ${target.accountId.length} characters).`);
  }
  for (const [name, id] of [["D1_DATABASE_ID", target.databaseId], ["SYNC_D1_DATABASE_ID", target.syncDatabaseId]]) {
    if (!idPattern.test(id)) {
      throw new Error(`${name} must be the database's 36-character UUID (Database ID in the Cloudflare D1 dashboard), not its name; got ${id.length} characters.`);
    }
  }
  if (target.databaseId.toLowerCase() === target.syncDatabaseId.toLowerCase()) {
    throw new Error("D1_DATABASE_ID and SYNC_D1_DATABASE_ID must be different databases.");
  }
  return target;
}

/** Returns the merge commit to deploy, or throws unless this is a merged same-repository vX.XX -> main pull request. */
export function productionDeployCommit(environment, event) {
  const pullRequest = event?.pull_request;
  if (environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_EVENT_NAME !== "pull_request" ||
      event?.action !== "closed" || pullRequest?.merged !== true || pullRequest.base?.ref !== "main" ||
      !versionBranchPattern.test(pullRequest.head?.ref ?? "") || !environment.GITHUB_REPOSITORY ||
      pullRequest.head?.repo?.full_name !== environment.GITHUB_REPOSITORY ||
      typeof pullRequest.merge_commit_sha !== "string" || !/^[0-9a-f]{40}$/.test(pullRequest.merge_commit_sha)) {
    throw new Error("Production deployment runs only from GitHub Actions after a vX.XX pull request merges into main.");
  }
  return pullRequest.merge_commit_sha;
}

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

/**
 * Validates the runtime secrets supplied for this deploy. Omitted (unset or empty) secrets are not uploaded, and
 * Wrangler keeps the Worker's existing value; supply one only to set or rotate it.
 */
export function buildWorkerSecrets(environment) {
  const names = ["VAPID_PRIVATE_KEY", "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URI", "OIDC_CLIENT_ID",
    "OIDC_REDIRECT_URI", "AUTH_SESSION_SECRET", "SYNC_CURSOR_SECRET", "ICS_FEED_ENCRYPTION_KEY", "OIDC_CLIENT_SECRET"];
  const secrets = Object.fromEntries(names.filter(name => typeof environment[name] === "string" && environment[name].trim())
    .map(name => [name, environment[name].trim()]));
  for (const name of ["VAPID_PRIVATE_KEY", "AUTH_SESSION_SECRET", "SYNC_CURSOR_SECRET", "ICS_FEED_ENCRYPTION_KEY"]) {
    const value = secrets[name];
    if (value !== undefined && (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, "base64url").byteLength !== 32)) {
      throw new Error(name === "VAPID_PRIVATE_KEY" ? "VAPID_PRIVATE_KEY must be a 32-byte base64url P-256 private key."
        : `${name} must be an independently generated 32-byte base64url value.`);
    }
  }
  for (const name of ["OIDC_ISSUER", "OIDC_JWKS_URI", "OIDC_REDIRECT_URI"]) {
    if (secrets[name] === undefined) continue;
    let url;
    try { url = new URL(secrets[name]); }
    catch { throw new Error(`${name} must be a valid HTTPS URL.`); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  if (secrets.OIDC_REDIRECT_URI !== undefined && new URL(secrets.OIDC_REDIRECT_URI).pathname !== "/api/v1/auth/callback") {
    throw new Error("OIDC_REDIRECT_URI must end at /api/v1/auth/callback without query or fragment parameters.");
  }
  return secrets;
}

async function deploy() {
  let event;
  try { event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH ?? "", "utf8")); }
  catch { event = undefined; }
  const commit = productionDeployCommit(process.env, event);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: appRoot, encoding: "utf8" });
  if (head.status !== 0 || head.stdout.trim() !== commit) throw new Error("The checked-out commit is not the merged main commit.");
  const { apiToken, accountId, databaseId, syncDatabaseId } = readDeployTarget(process.env);
  // Wrangler reads its credentials from the environment, so hand it the trimmed values.
  process.env.CLOUDFLARE_API_TOKEN = apiToken;
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
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
    runWrangler(["deploy", "--config", builtConfigPath, ...(Object.keys(workerSecrets).length ? ["--secrets-file", secretsPath] : [])]);
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
