import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_DEV_ADVISORY, isAllowedDevAuditReport } from "../scripts/audit-policy.mjs";

const braces = {
  severity: "high",
  dev: true,
  via: [{ severity: "high", url: ALLOWED_DEV_ADVISORY }]
};

test("allows the exact unpatched advisory when it affects dev dependencies only", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: { braces } }), true);
});

test("allows transitive dev-only packages only when their chain leads to the exact advisory", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces,
    micromatch: { severity: "high", dev: true, via: ["braces"] },
    "fast-glob": { severity: "high", dev: true, via: ["micromatch"] }
  } }), true);
});

test("rejects unrelated high-severity advisories", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces,
    minimatch: {
      severity: "high",
      dev: true,
      via: [{ severity: "high", url: "https://github.com/advisories/GHSA-other" }]
    }
  } }), false);
});

test("rejects the allowed advisory if an affected package is not dev-only", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces: { ...braces, dev: false }
  } }), false);
});

test("rejects broken or cyclic dependency chains", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces,
    micromatch: { severity: "high", dev: true, via: ["missing-package"] }
  } }), false);
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    alpha: { severity: "high", dev: true, via: ["beta"] },
    beta: { severity: "high", dev: true, via: ["alpha"] }
  } }), false);
});

test("accepts a clean high/critical audit result", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {} }), true);
});
