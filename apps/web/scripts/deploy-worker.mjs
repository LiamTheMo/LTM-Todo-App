import { spawnSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(appRoot, "wrangler.jsonc");
const builtConfigPath = path.join(appRoot, "dist/server/wrangler.json");
const idPlaceholder = "00000000-0000-4000-8000-000000000001";
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

function runWrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { cwd: appRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler exited with status ${result.status ?? "unknown"}.`);
}

async function deploy() {
  if (process.env.WORKERS_CI !== "1" || process.env.WORKERS_CI_BRANCH !== "main") {
    throw new Error("Production deployment is restricted to the main-branch Cloudflare Workers Build.");
  }
  const databaseId = process.env.D1_DATABASE_ID ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!databaseId || !privateKey) {
    throw new Error("Set the D1_DATABASE_ID and VAPID_PRIVATE_KEY build secrets in Cloudflare Workers Builds.");
  }

  const originalBuiltConfig = await readFile(builtConfigPath, "utf8");
  const sourceConfig = await readFile(configPath, "utf8");
  const migrationConfigPath = path.join(appRoot, `.wrangler.deploy-${process.pid}.jsonc`);
  const secretsPath = path.join(appRoot, `.wrangler.secrets-${process.pid}.json`);
  let builtConfigUpdated = false;

  try {
    const injectedSourceConfig = injectD1DatabaseId(sourceConfig, databaseId);
    await writeFile(migrationConfigPath, injectedSourceConfig, { mode: 0o600 });

    const deployedBuiltConfig = injectBuiltD1DatabaseId(originalBuiltConfig, databaseId);
    await writeFile(builtConfigPath, deployedBuiltConfig, { mode: 0o600 });
    builtConfigUpdated = true;
    await writeFile(secretsPath, JSON.stringify({ VAPID_PRIVATE_KEY: privateKey }), { mode: 0o600 });

    runWrangler(["d1", "migrations", "apply", "ltm-todo-notifications", "--remote", "--config", migrationConfigPath]);
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
