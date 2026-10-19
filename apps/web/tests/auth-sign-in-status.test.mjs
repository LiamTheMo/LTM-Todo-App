import test from "node:test";
import assert from "node:assert/strict";
import { readAccountSignInStatus } from "../lib/auth-sign-in-status.ts";
import { withAuthSessionLock } from "../lib/auth-session-lock.ts";

test("reports a confirmed active account session independently of sync", async () => {
  let request;
  const status = await readAccountSignInStatus(async (input, init) => {
    request = { input: String(input), init };
    return Response.json({ authenticated: true, accountKey: "a".repeat(43) });
  });
  assert.equal(status, "signed_in");
  assert.equal(request.input, "/api/v1/auth/session");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
});

test("reports a signed-out state when the session endpoint says false or returns 401", async () => {
  assert.equal(await readAccountSignInStatus(async () => Response.json({ authenticated: false })), "signed_out");
  assert.equal(await readAccountSignInStatus(async () => new Response(null, { status: 401 })), "signed_out");
});

test("keeps failed or malformed session checks separate from signed-out state", async () => {
  assert.equal(await readAccountSignInStatus(async () => new Response(null, { status: 503 })), "unavailable");
  assert.equal(await readAccountSignInStatus(async () => Response.json({})), "unavailable");
  assert.equal(await readAccountSignInStatus(async () => { throw new Error("network unavailable"); }), "unavailable");
});

test("session checks share one cross-tab lock so a rotated refresh token is redeemed once", async () => {
  const requested = [];
  let tail = Promise.resolve();
  const locks = { request(name, options, callback) {
    requested.push({ name, options });
    const run = tail.then(callback);
    tail = run.catch(() => undefined);
    return run;
  } };
  const order = [];
  let releaseFirst;
  const first = withAuthSessionLock(async () => { order.push("first:start"); await new Promise(resolve => { releaseFirst = resolve; }); order.push("first:end"); return 1; }, undefined, locks);
  const second = withAuthSessionLock(async () => { order.push("second"); return 2; }, AbortSignal.timeout(10_000), locks);
  await new Promise(resolve => setTimeout(resolve, 0));
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
  assert.deepEqual(requested.map(item => item.name), ["ltm-auth-session", "ltm-auth-session"]);
  assert.ok(requested[1].options.signal instanceof AbortSignal);
  assert.equal(await withAuthSessionLock(async () => "no-lock-api", undefined, undefined), "no-lock-api");
});
