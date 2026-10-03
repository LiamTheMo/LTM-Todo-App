import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_DEV_ADVISORY, isAllowedDevAuditReport } from "../scripts/audit-policy.mjs";

const braces = {
  severity: "high",
  nodes: ["node_modules/braces"],
  via: [{ severity: "high", url: ALLOWED_DEV_ADVISORY }]
};
const devLock = {
  packages: {
    "node_modules/braces": { dev: true },
    "node_modules/micromatch": { dev: true },
    "node_modules/fast-glob": { dev: true },
    "node_modules/minimatch": { dev: true }
  }
};

test("allows the exact unpatched advisory for a lockfile-confirmed dev-only package", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: { braces } }, devLock), true);
});

test("allows transitive dev-only packages only when their chain reaches the exact advisory", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces,
    micromatch: { severity: "high", nodes: ["node_modules/micromatch"], via: ["braces"] },
    "fast-glob": { severity: "high", nodes: ["node_modules/fast-glob"], via: ["micromatch"] }
  } }, devLock), true);
});

test("rejects unrelated high-severity advisories", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces,
    minimatch: {
      severity: "high",
      nodes: ["node_modules/minimatch"],
      via: [{ severity: "high", url: "https://github.com/advisories/GHSA-other" }]
    }
  } }, devLock), false);
});

test("rejects affected packages whose lockfile nodes are production dependencies", () => {
  const prodLock = { packages: { "node_modules/braces": { dev: false } } };
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: { braces } }, prodLock), false);
});

test("rejects missing or unknown lockfile nodes", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces: { ...braces, nodes: ["node_modules/missing"] }
  } }, devLock), false);
});

test("rejects broken and cyclic dependency chains", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    braces,
    micromatch: { severity: "high", nodes: ["node_modules/micromatch"], via: ["missing-package"] }
  } }, devLock), false);
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {
    alpha: { severity: "high", nodes: ["node_modules/minimatch"], via: ["beta"] },
    beta: { severity: "high", nodes: ["node_modules/minimatch"], via: ["alpha"] }
  } }, devLock), false);
});

test("accepts a clean high/critical audit result", () => {
  assert.equal(isAllowedDevAuditReport({ vulnerabilities: {} }, devLock), true);
});
