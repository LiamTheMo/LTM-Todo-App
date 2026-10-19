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
  const access = await token(pair.privateKey, { iss: issuer, sub: "account-42",
    aud: [audience, `${issuer}/userinfo`], azp: clientId, exp: now / 1000 + 3600 });
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
  assert.equal(authorization.searchParams.get("scope"), "openid offline_access");
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

const discovery = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
  jwks_uri: jwksUri, revocation_endpoint: `${issuer}/revoke` };
const sessionId = "6f1c2d3e-4b5a-4c6d-8e7f-901234567890";

function memoryRegistry() {
  const sessions = new Map();
  return {
    sessions,
    async issue(principal, id, expiresAt) { sessions.set(id, { subject: principal.subject, expiresAt, revoked: false }); },
    async isActive(principal, id) { const row = sessions.get(id); return !!row && !row.revoked && row.subject === principal.subject && row.expiresAt > clock.now; },
    async extend(principal, id, expiresAt) {
      if (!await this.isActive(principal, id)) return false;
      sessions.get(id).expiresAt = expiresAt;
      return true;
    },
    async list() { return []; },
    async revoke(_principal, id) { const row = sessions.get(id); if (row) row.revoked = true; return !!row; },
    async revokeAll() { return 0; }
  };
}
const clock = { now };

function sessionCookieFrom(response) {
  const header = response.headers.getSetCookie().find(value => value.startsWith("__Host-ltm-session="));
  return header ? { pair: header.split(";")[0], header } : undefined;
}

async function refreshableSession(codec, values) {
  return `__Host-ltm-session=${await codec.seal({ sessionId, subject: "account-42", refreshToken: "refresh-1",
    sessionExpiresAt: clock.now + 29 * 86_400_000, ...values }, "session")}`;
}

test("refresh tokens keep a browser session signed in past access-token expiry and rotate safely", async () => {
  clock.now = now;
  const { pair, publicKey } = await createKeys();
  const registry = memoryRegistry();
  const tokenRequests = [];
  let flowNonce;
  let issued = 0;
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) return Response.json(discovery);
    if (url === jwksUri) return Response.json({ keys: [publicKey] });
    if (url === `${issuer}/token`) {
      const form = new URLSearchParams(init.body);
      tokenRequests.push(form);
      issued++;
      const access = await token(pair.privateKey, { iss: issuer, sub: "account-42", aud: audience, azp: clientId, exp: clock.now / 1000 + 3600 });
      if (form.get("grant_type") === "authorization_code") {
        const id = await token(pair.privateKey, { iss: issuer, sub: "account-42", aud: clientId, nonce: flowNonce, exp: clock.now / 1000 + 3600 });
        return Response.json({ access_token: access, id_token: id, refresh_token: "refresh-1", token_type: "Bearer", expires_in: 3600 });
      }
      return Response.json({ access_token: access, refresh_token: `refresh-${issued}`, token_type: "Bearer", expires_in: 3600 });
    }
    return new Response("unexpected", { status: 500 });
  };
  const codec = new AuthCookieCodec(secret);
  const service = new OidcSessionService({ ...authOptions({ publicKey }), now: () => clock.now, fetcher, sessionRegistry: registry });
  const login = await service.handle(new Request("https://app.example.test/api/v1/auth/login"));
  const flowCookie = login.headers.get("Set-Cookie").split(";")[0];
  flowNonce = (await codec.open(flowCookie.slice(flowCookie.indexOf("=") + 1), "flow")).nonce;
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "authorization-code-once");
  callback.searchParams.set("state", new URL(login.headers.get("Location")).searchParams.get("state"));
  const completed = await service.handle(new Request(callback, { headers: { Cookie: flowCookie } }));
  assert.equal(completed.status, 302);
  const initial = sessionCookieFrom(completed);
  assert.match(initial.header, /Max-Age=2592000;/);
  assert.equal([...registry.sessions.values()][0].expiresAt, now + 30 * 86_400_000);

  // Within the access-token lifetime no refresh is needed.
  const fresh = await service.handle(new Request("https://app.example.test/api/v1/auth/session", { headers: { Cookie: initial.pair } }));
  assert.equal((await fresh.json()).authenticated, true);
  assert.equal(sessionCookieFrom(fresh), undefined);
  assert.equal(tokenRequests.length, 1);

  // After expiry, sync APIs reject the stale access token until the session endpoint refreshes it.
  clock.now = now + 2 * 3_600_000;
  const auth = new OidcSessionAuthenticator({ ...authOptions({ publicKey }), now: () => clock.now, fetcher, sessionRegistry: registry });
  assert.equal(await auth.authenticate(new Request("https://app.example.test/api/v1/sync/pull", { headers: { Cookie: initial.pair } })), undefined);
  const refreshed = await service.handle(new Request("https://app.example.test/api/v1/auth/session", { headers: { Cookie: initial.pair } }));
  const refreshedStatus = await refreshed.json();
  assert.equal(refreshedStatus.authenticated, true);
  assert.equal(refreshedStatus.expiresAt, new Date(clock.now + 3_600_000).toISOString());
  assert.equal(tokenRequests[1].get("grant_type"), "refresh_token");
  assert.equal(tokenRequests[1].get("refresh_token"), "refresh-1");
  assert.equal(tokenRequests[1].get("client_id"), clientId);
  const rotated = sessionCookieFrom(refreshed);
  assert.match(rotated.header, /Max-Age=2592000; HttpOnly; Secure; SameSite=Lax/);
  const rotatedSession = await codec.open(rotated.pair.slice(rotated.pair.indexOf("=") + 1), "session");
  assert.equal(rotatedSession.refreshToken, "refresh-2");
  assert.equal(rotatedSession.sessionId, [...registry.sessions.keys()][0]);
  assert.equal([...registry.sessions.values()][0].expiresAt, clock.now + 30 * 86_400_000);
  assert.deepEqual(await auth.authenticate(new Request("https://app.example.test/api/v1/sync/pull", { headers: { Cookie: rotated.pair } })),
    { issuer, subject: "account-42" });

  // Logout revokes the provider refresh token and the server session even after the access token expires.
  clock.now += 2 * 3_600_000;
  const logout = await service.handle(new Request("https://app.example.test/api/v1/auth/logout", {
    method: "POST", headers: { Cookie: rotated.pair, Origin: "https://app.example.test" } }));
  assert.equal(logout.status, 204);
  assert.equal([...registry.sessions.values()][0].revoked, true);
});

test("logout revokes the provider refresh token when discovery advertises revocation", async () => {
  clock.now = now;
  const revoked = [];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) return Response.json(discovery);
    if (url === `${issuer}/revoke`) { revoked.push(new URLSearchParams(init.body)); return new Response(null, { status: 200 }); }
    return new Response("unexpected", { status: 500 });
  };
  const codec = new AuthCookieCodec(secret);
  const service = new OidcSessionService({ ...authOptions(), fetcher });
  const cookie = await refreshableSession(codec, { accessToken: "expired-access", expiresAt: now - 1_000 });
  const logout = await service.handle(new Request("https://app.example.test/api/v1/auth/logout", {
    method: "POST", headers: { Cookie: cookie, Origin: "https://app.example.test" } }));
  assert.equal(logout.status, 204);
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].get("token"), "refresh-1");
  assert.equal(revoked[0].get("token_type_hint"), "refresh_token");
});

test("session refresh signs out only on definitive rejection and survives transient provider failures", async () => {
  const { pair, publicKey } = await createKeys();
  const codec = new AuthCookieCodec(secret);
  const validAccess = async () => token(pair.privateKey, { iss: issuer, sub: "account-42", aud: audience, exp: clock.now / 1000 + 120 });
  const cases = [
    { name: "invalid_grant", status: 400, body: { error: "invalid_grant", error_description: "private-provider-description" },
      expired: true, expected: { authenticated: false }, clears: true, code: "session_refresh_rejected", providerError: "invalid_grant" },
    { name: "provider outage with expired access", status: 503, body: { error: "temporarily_unavailable" },
      expired: true, expectedStatus: 503, expected: { error: "authentication_unavailable" }, clears: false, code: "session_refresh_rejected", providerError: "temporarily_unavailable" },
    { name: "rate limited with expired access", status: 429, body: {},
      expired: true, expectedStatus: 503, expected: { error: "authentication_unavailable" }, clears: false, code: "session_refresh_rejected", providerError: "unknown" },
    { name: "network failure while access is still valid", throws: true,
      expired: false, authenticated: true, clears: false, code: "session_refresh_failed" },
    { name: "subject mismatch", subject: "someone-else", expired: true, expected: { authenticated: false }, clears: true, code: "session_refresh_token_invalid" }
  ];
  for (const item of cases) {
    clock.now = now;
    const diagnostics = [];
    let tokenRequests = 0;
    const fetcher = async input => {
      const url = String(input);
      if (url === `${issuer}/.well-known/openid-configuration`) return Response.json(discovery);
      if (url === jwksUri) return Response.json({ keys: [publicKey] });
      if (url === `${issuer}/token`) {
        tokenRequests++;
        if (item.throws) throw new Error("private-token-endpoint-details");
        if (item.subject) return Response.json({ access_token: await token(pair.privateKey, { iss: issuer, sub: item.subject, aud: audience,
          exp: clock.now / 1000 + 3600 }), token_type: "Bearer", expires_in: 3600 });
        return Response.json(item.body, { status: item.status });
      }
      return new Response("unexpected", { status: 500 });
    };
    const service = new OidcSessionService({ ...authOptions({ publicKey }), now: () => clock.now, fetcher,
      diagnosticLogger: value => diagnostics.push(value) });
    const cookie = await refreshableSession(codec, item.expired
      ? { accessToken: "expired-access", expiresAt: now - 1_000 }
      : { accessToken: await validAccess(), expiresAt: now + 120_000 });
    const response = await service.handle(new Request("https://app.example.test/api/v1/auth/session", { headers: { Cookie: cookie } }));
    assert.equal(response.status, item.expectedStatus ?? 200, item.name);
    const body = await response.json();
    if (item.authenticated) assert.equal(body.authenticated, true, item.name);
    else assert.deepEqual(body, item.expected, item.name);
    const cleared = response.headers.getSetCookie().some(value => value.startsWith("__Host-ltm-session=;"));
    assert.equal(cleared, item.clears, item.name);
    if (!item.clears) assert.equal(sessionCookieFrom(response), undefined, item.name);
    assert.equal(tokenRequests, 1, item.name);
    assert.equal(diagnostics.length, 1, item.name);
    assert.equal(diagnostics[0].route, "session", item.name);
    assert.equal(diagnostics[0].code, item.code, item.name);
    if (item.providerError) assert.equal(diagnostics[0].providerError, item.providerError, item.name);
    const logged = JSON.stringify(diagnostics);
    for (const value of ["refresh-1", "private-provider-description", "private-token-endpoint-details"]) assert.equal(logged.includes(value), false, item.name);
  }
});

test("a revoked or expired refreshable session never redeems its refresh token", async () => {
  clock.now = now;
  const codec = new AuthCookieCodec(secret);
  let tokenRequests = 0;
  const fetcher = async input => {
    if (String(input) === `${issuer}/.well-known/openid-configuration`) return Response.json(discovery);
    tokenRequests++;
    return new Response("unexpected", { status: 500 });
  };
  const registry = memoryRegistry();
  registry.sessions.set(sessionId, { subject: "account-42", expiresAt: now + 86_400_000, revoked: true });
  const service = new OidcSessionService({ ...authOptions(), fetcher, sessionRegistry: registry });
  const revoked = await service.handle(new Request("https://app.example.test/api/v1/auth/session", {
    headers: { Cookie: await refreshableSession(codec, { accessToken: "expired-access", expiresAt: now - 1_000 }) } }));
  assert.deepEqual(await revoked.json(), { authenticated: false });
  assert.equal(revoked.headers.getSetCookie().some(value => value.startsWith("__Host-ltm-session=;")), true);
  const lapsed = await service.handle(new Request("https://app.example.test/api/v1/auth/session", {
    headers: { Cookie: await refreshableSession(codec, { accessToken: "expired-access", expiresAt: now - 1_000, sessionExpiresAt: now - 1 }) } }));
  assert.deepEqual(await lapsed.json(), { authenticated: false });
  assert.equal(tokenRequests, 0);
});
