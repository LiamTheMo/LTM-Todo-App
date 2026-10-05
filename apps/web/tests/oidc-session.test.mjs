import test from "node:test";
import assert from "node:assert/strict";
import { AuthCookieCodec, OidcSessionAuthenticator, OidcSessionService } from "../lib/oidc-session.ts";

const issuer = "https://identity.example.test";
const audience = "ltm-todo-api";
const clientId = "ltm-web";
const jwksUri = `${issuer}/.well-known/jwks.json`;
const redirectUri = "https://app.example.test/api/v1/auth/callback";
const now = Date.parse("2026-10-03T12:00:00.000Z");
const encoder = new TextEncoder();
const secret = Buffer.alloc(32, 19).toString("base64url");
const b64url = value => Buffer.from(value).toString("base64url");

async function createKeys() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(publicKey, { kid: "key-1", use: "sig", alg: "RS256" });
  return { pair, publicKey };
}

async function token(privateKey, claims) {
  const first = b64url(JSON.stringify({ alg: "RS256", kid: "key-1", typ: "JWT" }));
  const second = b64url(JSON.stringify(claims));
  const signed = `${first}.${second}`;
  return `${signed}.${b64url(await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, encoder.encode(signed)))}`;
}

function authOptions(extra = {}) {
  return { issuer, audience, jwksUri, clientId, redirectUri, cookieSecret: secret,
    now: () => now, fetcher: async url => url === jwksUri ? Response.json({ keys: [extra.publicKey] }) : new Response("unexpected", { status: 500 }) };
}

test("auth cookie ciphertext is purpose-bound, authenticated, and rejects tampering", async () => {
  const codec = new AuthCookieCodec(secret);
  const sealed = await codec.seal({ value: "private" }, "flow");
  assert.deepEqual(await codec.open(sealed, "flow"), { value: "private" });
  assert.equal(await codec.open(sealed, "session"), undefined);
  assert.equal(await codec.open(`${sealed}x`, "flow"), undefined);
  assert.throws(() => new AuthCookieCodec(Buffer.alloc(8).toString("base64url")), /32 bytes/);
});

test("OIDC discovery failures stay generic and emit only safe diagnostic codes", async () => {
  const cases = [
    { code: "provider_discovery_fetch_failed", fetcher: async () => { throw new Error("private provider response details"); } },
    { code: "provider_discovery_http_error", fetcher: async (_url, init = {}) => {
      assert.equal(init.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "https://attacker.example/metadata" } });
    } },
    { code: "provider_issuer_mismatch", fetcher: async () => Response.json({ issuer: "https://unexpected.example",
      authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/oauth/token`, jwks_uri: jwksUri }) }
  ];
  for (const item of cases) {
    let diagnostic;
    const service = new OidcSessionService({ ...authOptions(), fetcher: item.fetcher,
      diagnosticLogger: value => { diagnostic = value; } });
    const marker = `private-return-to-${item.code}`;
    const returnTo = encodeURIComponent(`/tasks?marker=${marker}`);
    const response = await service.handle(new Request(`https://app.example.test/api/v1/auth/login?returnTo=${returnTo}`));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
    assert.deepEqual(diagnostic, { event: "oidc_authentication_failure", route: "login", code: item.code });
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
    assert.equal(JSON.stringify(diagnostic).includes(marker), false);
    assert.equal(JSON.stringify(diagnostic).includes("private provider response details"), false);
  }
});

test("OIDC code flow uses PKCE/state/nonce and creates an encrypted same-origin session", async () => {
  const { pair, publicKey } = await createKeys();
  let flowOptions;
  let requestForm;
  const issuedSessions = new Set();
  const revokedSessions = new Set();
  const remoteSessionKey = "a".repeat(64);
  const sessionRegistry = {
    async issue(principal, sessionId, expiresAt) { assert.equal(principal.subject, "account-42"); assert.ok(expiresAt > now); issuedSessions.add(sessionId); },
    async isActive(_principal, sessionId) { return issuedSessions.has(sessionId); },
    async list(_principal, currentSessionId) { return [
      { sessionKey: "b".repeat(64), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), lastSeenAt: new Date(now).toISOString(), current: currentSessionId ? issuedSessions.has(currentSessionId) : false },
      { sessionKey: remoteSessionKey, createdAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), lastSeenAt: new Date(now).toISOString(), current: false }
    ]; },
    async revoke(_principal, sessionId) { revokedSessions.add(sessionId); issuedSessions.delete(sessionId); return true; },
    async revokeAll() { for (const id of issuedSessions) revokedSessions.add(id); issuedSessions.clear(); return revokedSessions.size; }
  };
  const access = await token(pair.privateKey, { iss: issuer, sub: "account-42", aud: audience, exp: now / 1000 + 3600 });
  const fetcher = async (input, init = {}) => {
    assert.equal(init.redirect, "manual");
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) return Response.json({ issuer,
      authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: jwksUri });
    if (url === `${issuer}/token`) {
      requestForm = new URLSearchParams(init.body);
      const id = await token(pair.privateKey, { iss: issuer, sub: "account-42", aud: clientId, nonce: flowOptions.nonce,
        exp: now / 1000 + 3600 });
      return Response.json({ access_token: access, id_token: id, token_type: "Bearer", expires_in: 3600 });
    }
    if (url === jwksUri) return Response.json({ keys: [publicKey] });
    return new Response("unexpected", { status: 500 });
  };
  const options = { ...authOptions({ publicKey }), fetcher, sessionRegistry };
  const service = new OidcSessionService(options);
  const login = await service.handle(new Request("https://app.example.test/api/v1/auth/login?returnTo=%2Ftasks"));
  assert.equal(login.status, 302);
  const authorization = new URL(login.headers.get("Location"));
  assert.equal(authorization.origin, issuer);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("scope"), "openid");
  assert.equal(authorization.searchParams.get("audience"), audience);
  const flowCookie = login.headers.get("Set-Cookie").split(";")[0];
  const codec = new AuthCookieCodec(secret);
  const flow = await codec.open(flowCookie.slice(flowCookie.indexOf("=") + 1), "flow");
  flowOptions = flow;

  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "authorization-code-once");
  callback.searchParams.set("state", authorization.searchParams.get("state"));
  const completed = await service.handle(new Request(callback, { headers: { Cookie: flowCookie } }));
  assert.equal(completed.status, 302);
  assert.equal(new URL(completed.headers.get("Location")).pathname, "/tasks");
  assert.match(requestForm.get("code_verifier"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(requestForm.get("grant_type"), "authorization_code");
  const setCookies = completed.headers.getSetCookie();
  const sessionCookie = setCookies.find(value => value.startsWith("__Host-ltm-session=")).split(";")[0];
  assert.match(sessionCookie, /__Host-ltm-session=v1\./);
  assert.match(setCookies.find(value => value.startsWith("__Host-ltm-session=")), /HttpOnly; Secure; SameSite=Lax/);

  const status = await service.handle(new Request("https://app.example.test/api/v1/auth/session", { headers: { Cookie: sessionCookie } }));
  const sessionStatus = await status.json();
  assert.equal(sessionStatus.authenticated, true);
  assert.equal(sessionStatus.expiresAt, new Date(now + 3_600_000).toISOString());
  assert.match(sessionStatus.accountKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issuedSessions.size, 1);
  const sessionsResponse = await service.handle(new Request("https://app.example.test/api/v1/auth/sessions", { headers: { Cookie: sessionCookie } }));
  const sessionList = await sessionsResponse.json();
  assert.equal(sessionList.sessions.length, 2);
  assert.equal(sessionList.sessions.some(item => item.current), true);
  assert.equal(JSON.stringify(sessionList).includes([...issuedSessions][0]), false);
  const revoke = await service.handle(new Request(`https://app.example.test/api/v1/auth/sessions/${remoteSessionKey}`, {
    method: "POST", headers: { Cookie: sessionCookie, Origin: "https://app.example.test" }
  }));
  assert.equal(revoke.status, 200);
  assert.equal(revokedSessions.has(remoteSessionKey), true);
  const logout = await service.handle(new Request("https://app.example.test/api/v1/auth/logout", {
    method: "POST", headers: { Cookie: sessionCookie, Origin: "https://app.example.test" }
  }));
  assert.equal(logout.status, 204);
  assert.equal(logout.headers.getSetCookie().length, 2);
  assert.equal(issuedSessions.size, 0);
});

test("OIDC callback rejects a state mismatch and logout rejects cross-site origins", async () => {
  let diagnostic;
  const fetcher = async url => url === `${issuer}/.well-known/openid-configuration` ? Response.json({ issuer,
    authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: jwksUri }) : new Response("unexpected", { status: 500 });
  const service = new OidcSessionService({ ...authOptions(), fetcher, diagnosticLogger: value => { diagnostic = value; } });
  const login = await service.handle(new Request("https://app.example.test/api/v1/auth/login"));
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "one-time-code");
  callback.searchParams.set("state", "attacker-state");
  const failed = await service.handle(new Request(callback, { headers: { Cookie: cookie } }));
  assert.equal(failed.status, 401);
  assert.equal(await failed.text(), "Authentication failed. Please try signing in again.");
  assert.deepEqual(diagnostic, { event: "oidc_authentication_failure", route: "callback", code: "callback_flow_invalid" });
  const logout = await service.handle(new Request("https://app.example.test/api/v1/auth/logout", {
    method: "POST", headers: { Origin: "https://evil.example" }
  }));
  assert.equal(logout.status, 403);
});

test("OIDC callback logs redacted diagnostic codes for provider and token failures", async () => {
  const cases = [
    { code: "callback_provider_error", status: 401, callbackProviderError: true, expectedTokenRequests: 0 },
    { code: "callback_token_exchange_rejected", status: 401, providerError: "invalid_client", providerStatus: 401, expectedTokenRequests: 1,
      tokenResponse: () => Response.json({ error: "invalid_client", error_description: "private-provider-description" }, { status: 401 }) },
    { code: "callback_token_exchange_rejected", status: 401, providerError: "other", providerStatus: 400, expectedTokenRequests: 1,
      tokenResponse: () => Response.json({ error: "private-provider-error-code", error_description: "private-provider-description" }, { status: 400 }) },
    { code: "callback_token_exchange_rejected", status: 401, providerError: "unknown", providerStatus: 502, expectedTokenRequests: 1,
      tokenResponse: () => new Response("private-malformed-provider-body", { status: 502 }) },
    { code: "callback_token_exchange_failed", status: 503, expectedTokenRequests: 1,
      tokenResponse: () => { throw new Error("private-token-endpoint-details"); } },
    { code: "callback_token_response_invalid", status: 401, expectedTokenRequests: 1,
      tokenResponse: () => Response.json({ access_token: "private-access-token", expires_in: 3600 }) },
    { code: "callback_id_token_invalid", status: 401, expectedTokenRequests: 1,
      tokenResponse: () => Response.json({ access_token: "private-access-token", id_token: "private-id-token",
        token_type: "Bearer", expires_in: 3600 }) }
  ];

  for (const item of cases) {
    let diagnostic;
    let tokenRequests = 0;
    const fetcher = async input => {
      const url = String(input);
      if (url === `${issuer}/.well-known/openid-configuration`) return Response.json({ issuer,
        authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: jwksUri });
      if (url === `${issuer}/token`) {
        tokenRequests++;
        return item.tokenResponse();
      }
      return new Response("unexpected", { status: 500 });
    };
    const service = new OidcSessionService({ ...authOptions(), fetcher, diagnosticLogger: value => { diagnostic = value; } });
    const marker = "private-return-and-provider-error-marker";
    const login = await service.handle(new Request(
      `https://app.example.test/api/v1/auth/login?returnTo=${encodeURIComponent(`/tasks?marker=${marker}`)}`));
    const cookie = login.headers.get("Set-Cookie").split(";")[0];
    const authorization = new URL(login.headers.get("Location"));
    const callback = new URL(redirectUri);
    if (item.callbackProviderError) {
      callback.searchParams.set("error", "access_denied");
      callback.searchParams.set("error_description", marker);
    } else {
      callback.searchParams.set("code", "one-time-code");
      callback.searchParams.set("state", authorization.searchParams.get("state"));
    }

    const failed = await service.handle(new Request(callback, { headers: { Cookie: cookie } }));
    assert.equal(failed.status, item.status, item.code);
    if (item.status === 401) assert.equal(await failed.text(), "Authentication failed. Please try signing in again.");
    else assert.deepEqual(await failed.json(), { error: "authentication_unavailable" });
    assert.deepEqual(diagnostic, {
      event: "oidc_authentication_failure",
      route: "callback",
      code: item.code,
      ...(item.providerError ? { providerError: item.providerError, providerStatus: item.providerStatus } : {})
    });
    assert.equal(JSON.stringify(diagnostic).includes(marker), false);
    assert.equal(JSON.stringify(diagnostic).includes("private-token-endpoint-details"), false);
    assert.equal(JSON.stringify(diagnostic).includes("private-provider-description"), false);
    assert.equal(JSON.stringify(diagnostic).includes("private-provider-error-code"), false);
    assert.equal(JSON.stringify(diagnostic).includes("private-malformed-provider-body"), false);
    assert.equal(JSON.stringify(diagnostic).includes("private-access-token"), false);
    assert.equal(JSON.stringify(diagnostic).includes("private-id-token"), false);
    assert.equal(tokenRequests, item.expectedTokenRequests);
  }
});

test("browser-cookie sync writes require exact same-origin while bearer writes remain stateless", async () => {
  const { pair, publicKey } = await createKeys();
  const access = await token(pair.privateKey, { iss: issuer, sub: "account-42", aud: audience, exp: now / 1000 + 600 });
  const codec = new AuthCookieCodec(secret);
  const session = await codec.seal({ accessToken: access, expiresAt: now + 600_000 }, "session");
  const auth = new OidcSessionAuthenticator(authOptions({ publicKey }));
  const cookie = `__Host-ltm-session=${session}`;
  assert.equal(await auth.authenticate(new Request("https://app.example.test/api/v1/sync/push", {
    method: "POST", headers: { Cookie: cookie }
  })), undefined);
  assert.deepEqual(await auth.authenticate(new Request("https://app.example.test/api/v1/sync/push", {
    method: "POST", headers: { Cookie: cookie, Origin: "https://app.example.test" }
  })), { issuer, subject: "account-42" });
  assert.deepEqual(await auth.authenticate(new Request("https://app.example.test/api/v1/sync/push", {
    method: "POST", headers: { Authorization: `Bearer ${access}` }
  })), { issuer, subject: "account-42" });
});
