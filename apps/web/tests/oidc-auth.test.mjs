import test from "node:test";
import assert from "node:assert/strict";
import { OidcJwtAuthenticator } from "../lib/oidc-auth.ts";

const issuer = "https://identity.example.test/";
const audience = "ltm-todo-api";
const jwksUri = "https://identity.example.test/.well-known/jwks.json";
const now = Date.parse("2026-10-03T12:00:00.000Z");
const encoder = new TextEncoder();
const b64url = value => Buffer.from(value).toString("base64url");
const jwt = async (privateKey, claims, header = {}, algorithm = { name: "RSASSA-PKCS1-v1_5" }) => {
  const headerPart = b64url(JSON.stringify({ alg: "RS256", kid: "key-1", typ: "JWT", ...header }));
  const claimsPart = b64url(JSON.stringify(claims));
  const content = `${headerPart}.${claimsPart}`;
  const signature = await crypto.subtle.sign(algorithm, privateKey, encoder.encode(content));
  return `${content}.${b64url(signature)}`;
};

async function keys() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(publicKey, { kid: "key-1", use: "sig", alg: "RS256" });
  return { pair, publicKey };
}

const claims = overrides => ({ iss: issuer, sub: "account-subject", aud: audience,
  exp: now / 1000 + 600, nbf: now / 1000 - 30, iat: now / 1000 - 60, ...overrides });

test("verifies a signed OIDC access token and caches the issuer's key set", async () => {
  const { pair, publicKey } = await keys();
  let requests = 0;
  const auth = new OidcJwtAuthenticator({ issuer, audience, jwksUri, now: () => now, fetcher: async () => {
    requests++;
    return Response.json({ keys: [publicKey] });
  } });
  const token = await jwt(pair.privateKey, claims());
  const request = () => new Request("https://app.test/api/v1/sync/changes", { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(await auth.authenticate(request()), { issuer, subject: "account-subject" });
  assert.deepEqual(await auth.authenticate(request()), { issuer, subject: "account-subject" });
  assert.equal(requests, 1);
});

test("verifies the supported ES256 access-token profile", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(publicKey, { kid: "ec-key", use: "sig", alg: "ES256" });
  const auth = new OidcJwtAuthenticator({ issuer, audience, jwksUri, now: () => now,
    fetcher: async () => Response.json({ keys: [publicKey] }) });
  const token = await jwt(pair.privateKey, claims(), { alg: "ES256", kid: "ec-key", typ: "at+jwt" },
    { name: "ECDSA", hash: "SHA-256" });
  assert.deepEqual(await auth.authenticate(new Request("https://app.test", {
    headers: { Authorization: `Bearer ${token}` }
  })), { issuer, subject: "account-subject" });
});

test("rejects wrong issuer, audience, expired, future, unsupported, and unsigned tokens", async () => {
  const { pair, publicKey } = await keys();
  const auth = new OidcJwtAuthenticator({ issuer, audience, jwksUri, now: () => now,
    fetcher: async () => Response.json({ keys: [publicKey] }) });
  const verify = async (payload, header) => auth.authenticate(new Request("https://app.test", {
    headers: { Authorization: `Bearer ${await jwt(pair.privateKey, payload, header)}` }
  }));
  assert.equal(await verify(claims({ iss: "https://attacker.example/" })), undefined);
  assert.equal(await verify(claims({ aud: "other-api" })), undefined);
  assert.equal(await verify(claims({ exp: now / 1000 - 60 })), undefined);
  assert.equal(await verify(claims({ nbf: now / 1000 + 60 })), undefined);
  assert.equal(await verify(claims(), { alg: "HS256" }), undefined);
  const unsigned = `${b64url(JSON.stringify({ alg: "none", kid: "key-1" }))}.${b64url(JSON.stringify(claims()))}.AA`;
  assert.equal(await auth.authenticate(new Request("https://app.test", { headers: { Authorization: `Bearer ${unsigned}` } })), undefined);
});

test("refreshes unknown signing keys once and rejects bad signatures", async () => {
  const first = await keys();
  const second = await keys();
  second.publicKey.kid = "key-2";
  let requests = 0;
  const auth = new OidcJwtAuthenticator({ issuer, audience, jwksUri, now: () => now, fetcher: async () => {
    requests++;
    return Response.json({ keys: [requests === 1 ? first.publicKey : second.publicKey] });
  } });
  const signedWithUnknownKey = await jwt(second.pair.privateKey, claims(), { kid: "key-2" });
  assert.deepEqual(await auth.authenticate(new Request("https://app.test", {
    headers: { Authorization: `Bearer ${signedWithUnknownKey}` }
  })), { issuer, subject: "account-subject" });
  assert.equal(requests, 2);
  const wrongSignature = await jwt(first.pair.privateKey, claims(), { kid: "key-2" });
  assert.equal(await auth.authenticate(new Request("https://app.test", {
    headers: { Authorization: `Bearer ${wrongSignature}` }
  })), undefined);
});

test("rejects issuer signing-key redirects without following them", async () => {
  const { pair } = await keys();
  let fetchOptions;
  const auth = new OidcJwtAuthenticator({ issuer, audience, jwksUri, now: () => now,
    fetcher: async (_url, options = {}) => {
      fetchOptions = options;
      return new Response(null, { status: 302, headers: { Location: "https://attacker.example/keys" } });
    } });
  const token = await jwt(pair.privateKey, claims());
  await assert.rejects(() => auth.authenticate(new Request("https://app.test", {
    headers: { Authorization: `Bearer ${token}` }
  })), /signing keys/);
  assert.equal(fetchOptions.redirect, "manual");
});

test("fails closed and reports issuer-key outages without exposing token data", async () => {
  const auth = new OidcJwtAuthenticator({ issuer, audience, jwksUri, now: () => now,
    fetcher: async () => new Response("upstream diagnostic secret", { status: 503 }) });
  const { pair } = await keys();
  const token = await jwt(pair.privateKey, claims());
  await assert.rejects(() => auth.authenticate(new Request("https://app.test", {
    headers: { Authorization: `Bearer ${token}` }
  })), /signing keys/);
  assert.equal(await auth.authenticate(new Request("https://app.test", { headers: { Authorization: "Bearer short" } })), undefined);
});
