import test from "node:test";
import assert from "node:assert/strict";
import { readAccountSignInStatus } from "../lib/auth-sign-in-status.ts";

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
