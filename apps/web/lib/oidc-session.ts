import { OidcJwtAuthenticator, type OidcVerifierOptions } from "./oidc-auth.ts";
import type { SyncAuthenticator, SyncPrincipal } from "./sync-api.ts";
import type { AuthSessionRegistry } from "./auth-session-registry.ts";

const FLOW_COOKIE = "__Host-ltm-oidc-flow";
const SESSION_COOKIE = "__Host-ltm-session";
const MAX_COOKIE_CHARS = 12_000;
const MAX_COOKIE_VALUE_CHARS = 3_800;
const MAX_PROVIDER_RESPONSE_BYTES = 32_000;
const FLOW_LIFETIME_SECONDS = 10 * 60;
const MAX_SESSION_SECONDS = 24 * 60 * 60;
const decoder = new TextDecoder("utf-8", { fatal: true });

export type OidcSessionOptions = OidcVerifierOptions & {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  cookieSecret: string;
  fetcher?: typeof fetch;
  now?: () => number;
  sessionRegistry?: AuthSessionRegistry;
  diagnosticLogger?: (diagnostic: OidcAuthenticationDiagnostic) => void;
};

type OidcMetadata = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
};
type ProviderEndpoints = { authorization_endpoint: string; token_endpoint: string };
type OidcFlow = { state: string; nonce: string; verifier: string; returnPath: string; issuedAt: number };
type OidcSession = { accessToken: string; expiresAt: number; sessionId?: string };
type JsonObject = Record<string, unknown>;

export type OidcAuthenticationDiagnosticRoute =
  | "login" | "callback" | "session" | "sessions" | "session_revoke" | "logout" | "logout_all" | "unknown";
export type OidcAuthenticationDiagnosticCode =
  | "provider_discovery_fetch_failed"
  | "provider_discovery_http_error"
  | "provider_discovery_invalid_document"
  | "provider_issuer_mismatch"
  | "provider_jwks_uri_mismatch"
  | "provider_endpoint_invalid"
  | "callback_request_invalid"
  | "callback_provider_error"
  | "callback_flow_invalid"
  | "callback_code_invalid"
  | "callback_token_exchange_failed"
  | "callback_token_exchange_rejected"
  | "callback_token_response_invalid"
  | "callback_id_token_invalid"
  | "callback_access_token_invalid"
  | "callback_token_verification_failed"
  | "callback_identity_mismatch"
  | "callback_session_cookie_too_large"
  | "unexpected_error";
export type OidcAuthenticationDiagnostic = {
  event: "oidc_authentication_failure";
  route: OidcAuthenticationDiagnosticRoute;
  code: OidcAuthenticationDiagnosticCode;
};

class OidcDiscoveryFailure extends Error {
  readonly code: OidcAuthenticationDiagnosticCode;

  constructor(code: OidcAuthenticationDiagnosticCode) {
    super("OIDC provider discovery failed");
    this.name = "OidcDiscoveryFailure";
    this.code = code;
  }
}

class OidcCallbackFailure extends Error {
  readonly code: OidcAuthenticationDiagnosticCode;

  constructor(code: OidcAuthenticationDiagnosticCode) {
    super("OIDC callback processing failed");
    this.name = "OidcCallbackFailure";
    this.code = code;
  }
}

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const decode = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cookie value");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));
};

export class AuthCookieCodec {
  private readonly keyPromise: Promise<CryptoKey>;
  constructor(secret: string) {
    const raw = decode(secret);
    if (raw.byteLength !== 32) throw new Error("Auth cookie secret must be 32 bytes");
    this.keyPromise = crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async seal(value: unknown, purpose: "flow" | "session"): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`ltm-auth-${purpose}-v1`) },
      await this.keyPromise, toArrayBuffer(plaintext));
    return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
  }

  async open<T>(sealed: string, purpose: "flow" | "session"): Promise<T | undefined> {
    try {
      if (sealed.length > MAX_COOKIE_VALUE_CHARS) return;
      const [version, encodedIv, encodedCiphertext, extra] = sealed.split(".");
      if (version !== "v1" || !encodedIv || !encodedCiphertext || extra !== undefined) return;
      const iv = decode(encodedIv);
      if (iv.byteLength !== 12) return;
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv,
        additionalData: new TextEncoder().encode(`ltm-auth-${purpose}-v1`) }, await this.keyPromise, toArrayBuffer(decode(encodedCiphertext)));
      return JSON.parse(decoder.decode(plaintext)) as T;
    } catch { return; }
  }
}

/** Verifies either a native bearer token or an encrypted browser session cookie. */
export class OidcSessionAuthenticator implements SyncAuthenticator {
  private readonly options: OidcSessionOptions;
  private readonly jwt: OidcJwtAuthenticator;
  private readonly cookies: AuthCookieCodec;
  private readonly now: () => number;

  constructor(options: OidcSessionOptions) {
    this.options = options;
    this.jwt = new OidcJwtAuthenticator(options);
    this.cookies = new AuthCookieCodec(options.cookieSecret);
    this.now = options.now ?? Date.now;
  }

  async authenticate(request: Request): Promise<SyncPrincipal | undefined> {
    const cookies = parseCookies(request.headers.get("Cookie"));
    const sessionCookie = cookies.get(SESSION_COOKIE);
    if (request.method !== "GET" && sessionCookie && !isSameOrigin(request)) return;

    const token = request.headers.get("Authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (token) return this.jwt.verifyToken(token);
    if (!sessionCookie) return;
    const session = await this.cookies.open<OidcSession>(sessionCookie, "session");
    if (!session || typeof session.accessToken !== "string" || typeof session.expiresAt !== "number" ||
        session.expiresAt <= this.now() || session.expiresAt > this.now() + MAX_SESSION_SECONDS * 1000) return;
    const principal = await this.jwt.verifyToken(session.accessToken);
    if (!principal) return;
    if (this.options.sessionRegistry && (!session.sessionId || !await this.options.sessionRegistry.isActive(principal, session.sessionId))) return;
    return principal;
  }

  async readSession(request: Request): Promise<{ principal: SyncPrincipal; expiresAt: number; sessionId?: string } | undefined> {
    const cookie = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
    if (!cookie) return;
    const session = await this.cookies.open<OidcSession>(cookie, "session");
    if (!session || typeof session.accessToken !== "string" || typeof session.expiresAt !== "number" ||
        session.expiresAt <= this.now() || session.expiresAt > this.now() + MAX_SESSION_SECONDS * 1000) return;
    const principal = await this.jwt.verifyToken(session.accessToken);
    if (!principal) return;
    if (this.options.sessionRegistry && (!session.sessionId || !await this.options.sessionRegistry.isActive(principal, session.sessionId))) return;
    return { principal, expiresAt: session.expiresAt, ...(session.sessionId ? { sessionId: session.sessionId } : {}) };
  }

}

export class OidcSessionService {
  private readonly options: OidcSessionOptions;
  private readonly cookies: AuthCookieCodec;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly accessTokenVerifier: OidcJwtAuthenticator;
  private readonly idTokenVerifier: OidcJwtAuthenticator;
  private metadata?: { expiresAt: number; value: ProviderEndpoints };

  constructor(options: OidcSessionOptions) {
    this.options = options;
    this.cookies = new AuthCookieCodec(options.cookieSecret);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.accessTokenVerifier = new OidcJwtAuthenticator(options);
    this.idTokenVerifier = new OidcJwtAuthenticator({ ...options, audience: options.clientId });
    const callback = new URL(options.redirectUri);
    if (callback.protocol !== "https:" || !options.clientId.trim()) throw new Error("OIDC client and HTTPS redirect URI are required");
  }

  async handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      if (pathname === "/api/v1/auth/login" && request.method === "GET") return await this.login(request);
      if (pathname === "/api/v1/auth/callback" && request.method === "GET") return await this.callback(request);
      if (pathname === "/api/v1/auth/session" && request.method === "GET") return await this.session(request);
      if (pathname === "/api/v1/auth/sessions" && request.method === "GET") return await this.sessions(request);
      if (pathname === "/api/v1/auth/logout" && request.method === "POST") return await this.logout(request);
      if (pathname === "/api/v1/auth/logout-all" && request.method === "POST") return await this.logoutAll(request);
      if (/^\/api\/v1\/auth\/sessions\/[0-9a-f]{64}$/i.test(pathname) && request.method === "POST") return await this.revokeSession(request, pathname.slice(pathname.lastIndexOf("/") + 1));
      return json({ error: "not_found" }, 404);
    } catch (error) {
      const diagnostic: OidcAuthenticationDiagnostic = {
        event: "oidc_authentication_failure",
        route: diagnosticRoute(pathname),
        code: error instanceof OidcDiscoveryFailure || error instanceof OidcCallbackFailure
          ? error.code : "unexpected_error"
      };
      this.logDiagnostic(diagnostic);
      return json({ error: "authentication_unavailable" }, 503);
    }
  }

  private async login(request: Request): Promise<Response> {
    const metadata = await this.getMetadata();
    const url = new URL(request.url);
    const flow: OidcFlow = {
      state: randomValue(), nonce: randomValue(), verifier: randomValue(),
      returnPath: safeReturnPath(url.searchParams.get("returnTo")), issuedAt: this.now()
    };
    const challenge = encode(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(new TextEncoder().encode(flow.verifier)))));
    const authorization = new URL(metadata.authorization_endpoint);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("client_id", this.options.clientId);
    authorization.searchParams.set("audience", this.options.audience);
    authorization.searchParams.set("redirect_uri", this.options.redirectUri);
    authorization.searchParams.set("scope", "openid");
    authorization.searchParams.set("state", flow.state);
    authorization.searchParams.set("nonce", flow.nonce);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    const cookie = await this.cookies.seal(flow, "flow");
    if (cookie.length > MAX_COOKIE_VALUE_CHARS) return json({ error: "authentication_unavailable" }, 503);
    return new Response(null, { status: 302, headers: {
      Location: authorization.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Set-Cookie": cookieHeader(FLOW_COOKIE, cookie, FLOW_LIFETIME_SECONDS)
    } });
  }

  private async callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const callback = new URL(this.options.redirectUri);
    const flowCookie = parseCookies(request.headers.get("Cookie")).get(FLOW_COOKIE);
    const flow = flowCookie ? await this.cookies.open<OidcFlow>(flowCookie, "flow") : undefined;
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const flowValid = flow && Number.isFinite(flow.issuedAt) && flow.issuedAt <= this.now() &&
      flow.issuedAt + FLOW_LIFETIME_SECONDS * 1000 > this.now() && typeof flow.verifier === "string" &&
      typeof flow.nonce === "string" && typeof flow.state === "string" && state === flow.state;
    if (url.origin !== callback.origin || url.pathname !== callback.pathname) return this.authFailure("callback_request_invalid");
    if (url.searchParams.has("error")) return this.authFailure("callback_provider_error");
    if (!flowValid) return this.authFailure("callback_flow_invalid");
    if (!code || code.length > 4096) return this.authFailure("callback_code_invalid");

    const metadata = await this.getMetadata();
    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.options.redirectUri,
      client_id: this.options.clientId, code_verifier: flow.verifier });
    if (this.options.clientSecret) form.set("client_secret", this.options.clientSecret);
    let tokenResponse: Response;
    try {
      tokenResponse = await this.fetcher(metadata.token_endpoint, { method: "POST", redirect: "manual",
        signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    } catch {
      throw new OidcCallbackFailure("callback_token_exchange_failed");
    }
    if (!tokenResponse.ok) return this.authFailure("callback_token_exchange_rejected");
    const tokens = await readJsonBounded(tokenResponse);
    if (!isObject(tokens) || typeof tokens.access_token !== "string" ||
        typeof tokens.id_token !== "string" || typeof tokens.expires_in !== "number" || !Number.isInteger(tokens.expires_in) ||
        tokens.expires_in < 1 || tokens.expires_in > MAX_SESSION_SECONDS ||
        (tokens.token_type !== undefined && tokens.token_type !== "Bearer")) return this.authFailure("callback_token_response_invalid");

    let identity: SyncPrincipal | undefined;
    let accessPrincipal: SyncPrincipal | undefined;
    try {
      [identity, accessPrincipal] = await Promise.all([
        this.idTokenVerifier.verifyToken(tokens.id_token, flow.nonce),
        this.accessTokenVerifier.verifyToken(tokens.access_token)
      ]);
    } catch {
      throw new OidcCallbackFailure("callback_token_verification_failed");
    }
    if (!identity) return this.authFailure("callback_id_token_invalid");
    if (!accessPrincipal) return this.authFailure("callback_access_token_invalid");
    if (identity.issuer !== accessPrincipal.issuer || identity.subject !== accessPrincipal.subject) {
      return this.authFailure("callback_identity_mismatch");
    }
    const expiresAt = this.now() + tokens.expires_in * 1000;
    const sessionId = crypto.randomUUID();
    const session = await this.cookies.seal({ accessToken: tokens.access_token, expiresAt, sessionId } satisfies OidcSession, "session");
    if (session.length > MAX_COOKIE_VALUE_CHARS) return this.authFailure("callback_session_cookie_too_large");
    if (this.options.sessionRegistry) await this.options.sessionRegistry.issue(accessPrincipal, sessionId, expiresAt);
    const headers = new Headers({ Location: new URL(flow.returnPath, callback.origin).href, "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer" });
    headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, session, tokens.expires_in));
    headers.append("Set-Cookie", cookieHeader(FLOW_COOKIE, "", 0));
    return new Response(null, { status: 302, headers });
  }

  private async session(request: Request): Promise<Response> {
    const authenticator = new OidcSessionAuthenticator(this.options);
    const session = await authenticator.readSession(request);
    if (!session) return json({ authenticated: false });
    // Stable only within this deployment secret; it is a local sync-account guard, never authorization.
    const accountKeyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
      `${this.options.cookieSecret}\u0000${session.principal.issuer}\u0000${session.principal.subject}`));
    return json({ authenticated: true, expiresAt: new Date(session.expiresAt).toISOString(),
      accountKey: encode(new Uint8Array(accountKeyBytes)) });
  }

  private async sessions(request: Request): Promise<Response> {
    if (!this.options.sessionRegistry) return json({ error: "sessions_unavailable" }, 503);
    const session = await new OidcSessionAuthenticator(this.options).readSession(request);
    if (!session?.sessionId) return json({ error: "unauthorized" }, 401);
    return json({ sessions: await this.options.sessionRegistry.list(session.principal, session.sessionId) });
  }

  private async revokeSession(request: Request, sessionKey: string): Promise<Response> {
    if (!isSameOrigin(request)) return json({ error: "origin_rejected" }, 403);
    if (!this.options.sessionRegistry) return json({ error: "sessions_unavailable" }, 503);
    const current = await new OidcSessionAuthenticator(this.options).readSession(request);
    if (!current) return json({ error: "unauthorized" }, 401);
    await this.options.sessionRegistry.revoke(current.principal, sessionKey);
    return json({ revoked: true });
  }

  private async logoutAll(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return json({ error: "origin_rejected" }, 403);
    if (!this.options.sessionRegistry) return json({ error: "sessions_unavailable" }, 503);
    const current = await new OidcSessionAuthenticator(this.options).readSession(request);
    if (!current) return json({ error: "unauthorized" }, 401);
    await this.options.sessionRegistry.revokeAll(current.principal);
    return this.clearSessionCookies();
  }

  private async logout(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return json({ error: "origin_rejected" }, 403);
    const current = await new OidcSessionAuthenticator(this.options).readSession(request);
    if (current?.sessionId && this.options.sessionRegistry) await this.options.sessionRegistry.revoke(current.principal, current.sessionId);
    return this.clearSessionCookies();
  }

  private clearSessionCookies(): Response {
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, "", 0));
    headers.append("Set-Cookie", cookieHeader(FLOW_COOKIE, "", 0));
    return new Response(null, { status: 204, headers });
  }

  private authFailure(code: OidcAuthenticationDiagnosticCode): Response {
    this.logDiagnostic({ event: "oidc_authentication_failure", route: "callback", code });
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookieHeader(FLOW_COOKIE, "", 0));
    return new Response("Authentication failed. Please try signing in again.", { status: 401, headers });
  }

  private logDiagnostic(diagnostic: OidcAuthenticationDiagnostic): void {
    try {
      if (this.options.diagnosticLogger) this.options.diagnosticLogger(diagnostic);
      else console.error(JSON.stringify(diagnostic));
    } catch {
      // Diagnostics must never change the public authentication response.
    }
  }

  private async getMetadata(): Promise<ProviderEndpoints> {
    if (this.metadata && this.metadata.expiresAt > this.now()) return this.metadata.value;
    const issuer = this.options.issuer.replace(/\/$/, "");
    let response: Response;
    try {
      response = await this.fetcher(`${issuer}/.well-known/openid-configuration`, {
        redirect: "manual", signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" }
      });
    } catch {
      throw new OidcDiscoveryFailure("provider_discovery_fetch_failed");
    }
    if (!response.ok) throw new OidcDiscoveryFailure("provider_discovery_http_error");
    let metadataValue: unknown;
    try {
      metadataValue = await readJsonBounded(response);
    } catch {
      throw new OidcDiscoveryFailure("provider_discovery_invalid_document");
    }
    if (!isObject(metadataValue)) throw new OidcDiscoveryFailure("provider_discovery_invalid_document");
    const metadata = metadataValue as OidcMetadata;
    if (metadata.issuer !== this.options.issuer) throw new OidcDiscoveryFailure("provider_issuer_mismatch");
    if (metadata.jwks_uri !== this.options.jwksUri) throw new OidcDiscoveryFailure("provider_jwks_uri_mismatch");
    if (typeof metadata.authorization_endpoint !== "string" || typeof metadata.token_endpoint !== "string") {
      throw new OidcDiscoveryFailure("provider_discovery_invalid_document");
    }
    for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
      if (typeof endpoint !== "string") throw new OidcDiscoveryFailure("provider_discovery_invalid_document");
      let parsedEndpoint: URL;
      try {
        parsedEndpoint = new URL(endpoint);
      } catch {
        throw new OidcDiscoveryFailure("provider_endpoint_invalid");
      }
      if (parsedEndpoint.protocol !== "https:") throw new OidcDiscoveryFailure("provider_endpoint_invalid");
    }
    const value = { authorization_endpoint: metadata.authorization_endpoint, token_endpoint: metadata.token_endpoint };
    this.metadata = { value, expiresAt: this.now() + 10 * 60_000 };
    return value;
  }
}

function diagnosticRoute(pathname: string): OidcAuthenticationDiagnosticRoute {
  switch (pathname) {
    case "/api/v1/auth/login": return "login";
    case "/api/v1/auth/callback": return "callback";
    case "/api/v1/auth/session": return "session";
    case "/api/v1/auth/sessions": return "sessions";
    case "/api/v1/auth/logout": return "logout";
    case "/api/v1/auth/logout-all": return "logout_all";
    default: return /^\/api\/v1\/auth\/sessions\/[0-9a-f]{64}$/i.test(pathname) ? "session_revoke" : "unknown";
  }
}

function randomValue(): string { return encode(crypto.getRandomValues(new Uint8Array(32))); }

function safeReturnPath(value: string | null): string {
  if (!value || value.length > 1024 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return "/";
  try { const parsed = new URL(value, "https://return.invalid"); return parsed.origin === "https://return.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/"; }
  catch { return "/"; }
}

function parseCookies(header: string | null): Map<string, string> {
  const result = new Map<string, string>();
  if (!header || header.length > MAX_COOKIE_CHARS) return result;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!result.has(key)) result.set(key, value);
  }
  return result;
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

async function readJsonBounded(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("Content-Length") ?? 0) > MAX_PROVIDER_RESPONSE_BYTES) return;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) { await reader.cancel(); return; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(decoder.decode(bytes));
  } catch { return; }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
