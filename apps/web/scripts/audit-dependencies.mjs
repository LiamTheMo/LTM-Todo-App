import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAllowedDevAuditReport } from "./audit-policy.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

function run(args, options = {}) {
  const result = spawnSync(npm, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
  if (result.error) {
    console.error(`Unable to run npm ${args.join(" ")}: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

const production = run(["audit", "--omit=dev", "--audit-level=high"], { stdio: "inherit" });
if (production.status !== 0) {
  console.error("Production dependency audit failed.");
  process.exit(production.status || 1);
}

const full = run(["audit", "--json"]);
let report;
try {
  report = JSON.parse(full.stdout);
} catch {
  console.error(full.stderr || full.stdout || "npm audit did not return valid JSON.");
  process.exit(1);
}
if (full.status !== 0 && full.status !== 1) {
  console.error(full.stderr || `npm audit exited with status ${full.status}.`);
  process.exit(full.status || 1);
}
if (!isAllowedDevAuditReport(report, lockfile)) {
  console.error("Full dependency audit found an unapproved high/critical advisory or a non-dev affected lockfile node.");
  console.error(JSON.stringify(report.vulnerabilities ?? {}, null, 2));
  process.exit(1);
}

const allowed = Object.entries(report.vulnerabilities ?? {})
  .filter(([, issue]) => issue && (issue.severity === "high" || issue.severity === "critical"))
  .map(([name]) => name);
if (allowed.length) {
  console.warn(
    `Production audit passed. Allowing only the unpatched dev-only GHSA-vfj7-8cjw-p6xm chain after checking package-lock nodes: ${allowed.join(", ")}. Remove this exception when braces publishes a fix.`
  );
} else {
  console.log("Production and full high/critical dependency audits passed.");
}
