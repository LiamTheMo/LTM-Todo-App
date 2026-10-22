import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { isAllowedDevAuditReport, isAuditReport } from "./audit-policy.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 20 * 1000;

/** Run npm audit as JSON, retrying only when the registry fails to return a report. Findings are never retried. */
async function audit(args) {
  const label = ["npm audit", ...args].join(" ");
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync(npm, ["audit", "--json", ...args], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: ATTEMPT_TIMEOUT_MS
    });
    let report = null;
    try { report = JSON.parse(result.stdout); } catch { report = null; }
    if (!result.error && (result.status === 0 || result.status === 1) && isAuditReport(report)) return { status: result.status, report };

    const reason = result.error?.message || report?.message || result.stderr?.trim() || `npm audit exited with status ${result.status}`;
    if (attempt >= ATTEMPTS) {
      console.error(`${label} did not return a report after ${ATTEMPTS} attempts: ${reason}`);
      process.exit(1);
    }
    console.warn(`${label} attempt ${attempt} returned no report (${reason}); retrying.`);
    await delay(RETRY_DELAY_MS);
  }
}

const production = await audit(["--omit=dev", "--audit-level=high"]);
if (production.status !== 0) {
  console.error("Production dependency audit failed.");
  console.error(JSON.stringify(production.report.vulnerabilities, null, 2));
  process.exit(1);
}
console.log(`Production audit: ${JSON.stringify(production.report.metadata.vulnerabilities)}`);

const { report } = await audit([]);
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
