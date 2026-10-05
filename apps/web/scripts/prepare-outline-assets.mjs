import { copyFile, mkdir, readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("node_modules/pdfjs-dist/package.json", root), "utf8"));
if (version !== "6.4.299") throw new Error("Update the outline PDF worker URL when upgrading pdfjs-dist.");
await mkdir(new URL("public/vendor/", root), { recursive: true });
await copyFile(new URL("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", root), new URL(`public/vendor/pdfjs-${version}.worker.min.mjs`, root));
