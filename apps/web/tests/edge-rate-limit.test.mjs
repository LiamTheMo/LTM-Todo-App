import test from "node:test";
import assert from "node:assert/strict";
import { enforceEdgeRateLimit } from "../lib/edge-rate-limit.ts";

test("creates a namespaced ephemeral key from Cloudflare's client-IP header", async () => {
  let key;
  const response = await enforceEdgeRateLimit(new Request("https://app.test/api/v1/sync/changes", {
    headers: { "CF-Connecting-IP": "2001:db8::10" }
  }), { async limit(options) { key = options.key; return { success: true }; } }, "sync");
  assert.equal(response, undefined);
  assert.equal(key, "ltm-v3:sync:2001:db8::10");
});

test("returns a non-cacheable throttle response without exposing the source IP", async () => {
  const response = await enforceEdgeRateLimit(new Request("https://app.test/api/v1/auth/login", {
    headers: { "CF-Connecting-IP": "203.0.113.42" }
  }), { async limit() { return { success: false }; } }, "auth");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(await response.json(), { error: "rate_limited" });
});

test("fails closed when Cloudflare source identity or the rate-limit service is unavailable", async () => {
  const missing = await enforceEdgeRateLimit(new Request("https://app.test"), { async limit() { return { success: true }; } }, "sync");
  assert.equal(missing.status, 503);
  const failed = await enforceEdgeRateLimit(new Request("https://app.test", { headers: { "CF-Connecting-IP": "203.0.113.42" } }), {
    async limit() { throw new Error("internal binding detail"); }
  }, "sync");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "service_unavailable" });
});
