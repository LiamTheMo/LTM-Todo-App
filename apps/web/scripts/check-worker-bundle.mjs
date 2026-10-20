import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Static `import ... from "./x"`, side-effect `import "./x"`, `export ... from "./x"` and dynamic `import("./x")`.
const relativeSpecifier = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"'?#]+)["']/g;

async function* scripts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* scripts(target);
    else if (/\.m?js$/.test(entry.name)) yield target;
  }
}

/** Lists relative imports in the built Worker that point at files missing from the upload. */
export async function missingWorkerImports(serverDirectory) {
  const missing = [];
  for await (const file of scripts(serverDirectory)) {
    const source = await readFile(file, "utf8");
    for (const [, specifier] of source.matchAll(relativeSpecifier)) {
      const target = path.resolve(path.dirname(file), specifier);
      if (!(await stat(target).catch(() => null))?.isFile()) {
        missing.push(`${path.relative(serverDirectory, file)} imports ${specifier}`);
      }
    }
  }
  return missing;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = await missingWorkerImports(path.join(appRoot, "dist/server"));
  if (missing.length) {
    console.error(`The Worker bundle imports modules that are not in the build output, so Cloudflare would reject it:\n${missing.map(item => `- ${item}`).join("\n")}`);
    process.exitCode = 1;
  } else console.log("Worker bundle imports resolve.");
}
