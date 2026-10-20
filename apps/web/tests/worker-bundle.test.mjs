import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { missingWorkerImports } from "../scripts/check-worker-bundle.mjs";

test("the Worker bundle check reports relative imports that point outside the build output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "worker-bundle-"));
  try {
    await mkdir(path.join(root, "_next/static"), { recursive: true });
    await writeFile(path.join(root, "__vinext_manifest.js"), "export default {};");
    await writeFile(path.join(root, "index.js"), 'import "./_next/static/entry.js";export*from"./__vinext_manifest.js";');
    // Mirrors the rolldown 1.2.14 output Cloudflare rejected: a chunk importing a root module as if it were a sibling.
    await writeFile(path.join(root, "_next/static/entry.js"),
      'import a from"../../__vinext_manifest.js";import b from"./__vinext_manifest.js";const c=import("./lazy.js");import"node:buffer";');
    assert.deepEqual((await missingWorkerImports(root)).sort(), [
      `${path.join("_next", "static", "entry.js")} imports ./__vinext_manifest.js`,
      `${path.join("_next", "static", "entry.js")} imports ./lazy.js`
    ]);
    await writeFile(path.join(root, "_next/static/entry.js"), 'import a from"../../__vinext_manifest.js";');
    assert.deepEqual(await missingWorkerImports(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
