export const ALLOWED_DEV_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";

const isHigh = severity => severity === "high" || severity === "critical";

/** Allow only the known unpatched braces advisory on dev-only dependencies. */
export function isAllowedDevAuditReport(report) {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") return false;

  function isAllowedPackage(name, visited = new Set()) {
    const issue = vulnerabilities[name];
    if (!issue || issue.dev !== true || !isHigh(issue.severity) || visited.has(name)) return false;

    const nextVisited = new Set(visited);
    nextVisited.add(name);
    if (!Array.isArray(issue.via) || issue.via.length === 0) return false;

    let foundAllowedAdvisory = false;
    for (const cause of issue.via) {
      if (typeof cause === "string") {
        const linked = vulnerabilities[cause];
        if (!linked) return false;
        if (isHigh(linked.severity) && !isAllowedPackage(cause, nextVisited)) return false;
        continue;
      }
      if (!cause || typeof cause !== "object" || typeof cause.severity !== "string") return false;
      if (!isHigh(cause.severity)) continue;
      if (cause.url !== ALLOWED_DEV_ADVISORY) return false;
      foundAllowedAdvisory = true;
    }
    return foundAllowedAdvisory || issue.via.some(cause =>
      typeof cause === "string" && vulnerabilities[cause] && isHigh(vulnerabilities[cause].severity)
    );
  }

  return Object.entries(vulnerabilities)
    .filter(([, issue]) => issue && isHigh(issue.severity))
    .every(([name]) => isAllowedPackage(name));
}
