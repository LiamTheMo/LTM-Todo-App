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
// Rolling lifetime of a refreshable browser session; each successful refresh extends it.
const REFRESHABLE_SESSION_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_WINDOW_MS = 5 * 60_000;
const MAX_REFRESH_TOKEN_CHARS = 2_048;
const decoder = new TextDecoder("utf-8", { fatal: true });

export type OidcSessionOptions = OidcVerifierOptions & {
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
  revocation_endpoint?: unknown;
};
type ProviderEndpoints = { authorization_endpoint: string; token_endpoint: string; revocation_endpoint?: string };
type OidcFlow = { state: string; nonce: string; verifier: string; returnPath: string; issuedAt: number };
/** `expiresAt` is the access-token expiry; refreshable sessions also carry the provider refresh token and a rolling session expiry. */
type OidcSession = {
  accessToken: string; expiresAt: number; sessionId?: string;
  refreshToken?: string; sessionExpiresAt?: number; subject?: string;
};
type RefreshResult =
  | { kind: "refreshed"; session: OidcSession; cookie: string }
  | { kind: "rejected" }
  | { kind: "unavailable" };
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
  | "session_refresh_failed"
  | "session_refresh_rejected"
  | "session_refresh_response_invalid"
  | "session_refresh_token_invalid"
  | "unexpected_error";
export type OidcAuthenticationProviderError =
  | "access_denied"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_request"
  | "invalid_scope"
  | "server_error"
  | "temporarily_unavailable"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "other"
  | "unknown";
export type OidcAuthenticationDiagnostic = {
  event: "oidc_authentication_failure";
  route: OidcAuthenticationDiagnosticRoute;
  code: OidcAuthenticationDiagnosticCode;
  providerError?: OidcAuthenticationProviderError;
  providerStatus?: number;
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
const PROVIDER_OAUTH_ERRORS = new Set<string>([
  "access_denied", "invalid_client", "invalid_grant", "invalid_request", "invalid_scope",
  "server_error", "temporarily_unavailable", "unauthorized_client", "unsupported_grant_type",
  "unsupported_response_type"
]);
const normalizeProviderError = (value: unknown): OidcAuthenticationProviderError => {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  return PROVIDER_OAUTH_ERRORS.has(value) ? value as OidcAuthenticationProviderError : "other";
};
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
    const session = await openSessionCookie(this.cookies, sessionCookie, this.now());
    return session ? (await this.verifySession(session))?.principal : undefined;
  }

  async readSession(request: Request): Promise<{ principal: SyncPrincipal; expiresAt: number; sessionId?: string } | undefined> {
    const cookie = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
    if (!cookie) return;
    const session = await openSessionCookie(this.cookies, cookie, this.now());
    return session ? this.verifySession(session) : undefined;
  }

  /** Requires an unexpired access token; refreshing happens only through the session endpoint, which can set cookies. */
  async verifySession(session: OidcSession): Promise<{ principal: SyncPrincipal; expiresAt: number; sessionId?: string } | undefined> {
    if (session.expiresAt <= this.now()) return;
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
    authorization.searchParams.set("scope", "openid offline_access");
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
    if (!tokenResponse.ok) {
      let responseError: unknown;
      try {
        const errorResponse = await readJsonBounded(tokenResponse);
        if (isObject(errorResponse)) responseError = errorResponse.error;
      } catch {
        // Keep the generic rejection diagnostic if the provider body is malformed or unavailable.
      }
      return this.authFailure("callback_token_exchange_rejected", {
        providerError: normalizeProviderError(responseError),
        providerStatus: tokenResponse.status
      });
    }
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
    const baseSession: OidcSession = { accessToken: tokens.access_token, expiresAt, sessionId };
    let sessionValue: OidcSession = baseSession;
    let session = "";
    if (validRefreshToken(tokens.refresh_token)) {
      sessionValue = { ...baseSession, refreshToken: tokens.refresh_token, subject: accessPrincipal.subject,
        sessionExpiresAt: this.now() + REFRESHABLE_SESSION_SECONDS * 1000 };
      session = await this.cookies.seal(sessionValue, "session");
    }
    // A refresh token that does not fit the cookie leaves an ordinary access-token-lifetime session.
    if (!session || session.length > MAX_COOKIE_VALUE_CHARS) {
      sessionValue = baseSession;
      session = await this.cookies.seal(sessionValue, "session");
    }
    if (session.length > MAX_COOKIE_VALUE_CHARS) return this.authFailure("callback_session_cookie_too_large");
    if (this.options.sessionRegistry) await this.options.sessionRegistry.issue(accessPrincipal, sessionId, sessionValue.sessionExpiresAt ?? expiresAt);
    const headers = new Headers({ Location: new URL(flow.returnPath, callback.origin).href, "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer" });
    headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, session, sessionCookieMaxAge(sessionValue, this.now())));
    headers.append("Set-Cookie", cookieHeader(FLOW_COOKIE, "", 0));
    return new Response(null, { status: 302, headers });
  }

  private async session(request: Request): Promise<Response> {
    const cookie = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
    let current = cookie ? await openSessionCookie(this.cookies, cookie, this.now()) : undefined;
    let refreshedCookie: string | undefined;
    if (current?.refreshToken && current.expiresAt - this.now() <= REFRESH_WINDOW_MS) {
      const refreshed = await this.refreshSession(current);
      if (refreshed.kind === "rejected") return this.clearSessionCookies(json({ authenticated: false }));
      if (refreshed.kind === "refreshed") {
        current = refreshed.session;
        refreshedCookie = refreshed.cookie;
      } else if (current.expiresAt <= this.now()) {
        // Keep the refresh token for a later retry instead of signing out after a transient provider failure.
        return json({ error: "authentication_unavailable" }, 503);
      }
    }
    const session = current ? await new OidcSessionAuthenticator(this.options).verifySession(current) : undefined;
    if (!session) return json({ authenticated: false });
    // Stable only within this deployment secret; it is a local sync-account guard, never authorization.
    const accountKeyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
      `${this.options.cookieSecret}\u0000${session.principal.issuer}\u0000${session.principal.subject}`));
    const response = json({ authenticated: true, expiresAt: new Date(session.expiresAt).toISOString(),
      accountKey: encode(new Uint8Array(accountKeyBytes)) });
    if (refreshedCookie && current) {
      response.headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, refreshedCookie, sessionCookieMaxAge(current, this.now())));
    }
    return response;
  }

  /** Redeems the session's refresh token once; rotation-aware providers return a replacement refresh token. */
  private async refreshSession(session: OidcSession): Promise<RefreshResult> {
    if (!session.refreshToken || !session.subject || !session.sessionExpiresAt) return { kind: "rejected" };
    const principal: SyncPrincipal = { issuer: this.options.issuer, subject: session.subject };
    const registry = this.options.sessionRegistry;
    if (registry && (!session.sessionId || !await registry.isActive(principal, session.sessionId))) return { kind: "rejected" };
    let tokenResponse: Response;
    try {
      const metadata = await this.getMetadata();
      const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: this.options.clientId });
      if (this.options.clientSecret) form.set("client_secret", this.options.clientSecret);
      tokenResponse = await this.fetcher(metadata.token_endpoint, { method: "POST", redirect: "manual",
        signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    } catch {
      this.logDiagnostic({ event: "oidc_authentication_failure", route: "session", code: "session_refresh_failed" });
      return { kind: "unavailable" };
    }
    if (!tokenResponse.ok) {
      let responseError: unknown;
      try {
        const errorResponse = await readJsonBounded(tokenResponse);
        if (isObject(errorResponse)) responseError = errorResponse.error;
      } catch {
        // Keep the generic rejection diagnostic if the provider body is malformed or unavailable.
      }
      this.logDiagnostic({ event: "oidc_authentication_failure", route: "session", code: "session_refresh_rejected",
        providerError: normalizeProviderError(responseError), providerStatus: tokenResponse.status });
      // Only a definitive client error ends the session; rate limits and provider outages are retried later.
      return tokenResponse.status >= 400 && tokenResponse.status < 500 && tokenResponse.status !== 408 && tokenResponse.status !== 429
        ? { kind: "rejected" } : { kind: "unavailable" };
    }
    const tokens = await readJsonBounded(tokenResponse);
    if (!isObject(tokens) || typeof tokens.access_token !== "string" ||
        typeof tokens.expires_in !== "number" || !Number.isInteger(tokens.expires_in) ||
        tokens.expires_in < 1 || tokens.expires_in > MAX_SESSION_SECONDS ||
        (tokens.token_type !== undefined && tokens.token_type !== "Bearer") ||
        (tokens.refresh_token !== undefined && !validRefreshToken(tokens.refresh_token))) {
      this.logDiagnostic({ event: "oidc_authentication_failure", route: "session", code: "session_refresh_response_invalid" });
      return { kind: "unavailable" };
    }
    let refreshedPrincipal: SyncPrincipal | undefined;
    try {
      refreshedPrincipal = await this.accessTokenVerifier.verifyToken(tokens.access_token);
    } catch {
      this.logDiagnostic({ event: "oidc_authentication_failure", route: "session", code: "session_refresh_failed" });
      return { kind: "unavailable" };
    }
    if (!refreshedPrincipal || refreshedPrincipal.issuer !== principal.issuer || refreshedPrincipal.subject !== principal.subject) {
      this.logDiagnostic({ event: "oidc_authentication_failure", route: "session", code: "session_refresh_token_invalid" });
      return { kind: "rejected" };
    }
    const sessionExpiresAt = this.now() + REFRESHABLE_SESSION_SECONDS * 1000;
    const refreshed: OidcSession = { ...session, accessToken: tokens.access_token, expiresAt: this.now() + tokens.expires_in * 1000,
      refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : session.refreshToken, sessionExpiresAt };
    const cookie = await this.cookies.seal(refreshed, "session");
    if (cookie.length > MAX_COOKIE_VALUE_CHARS) {
      this.logDiagnostic({ event: "oidc_authentication_failure", route: "session", code: "session_refresh_response_invalid" });
      return { kind: "rejected" };
    }
    if (registry && session.sessionId && !await registry.extend(principal, session.sessionId, sessionExpiresAt)) return { kind: "rejected" };
    return { kind: "refreshed", session: refreshed, cookie };
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
    const cookie = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
    const session = cookie ? await openSessionCookie(this.cookies, cookie, this.now()) : undefined;
    const current = session ? await new OidcSessionAuthenticator(this.options).verifySession(session) : undefined;
    // The sealed subject identifies a refreshable session whose access token has already expired.
    const principal = current?.principal ?? (session?.subject ? { issuer: this.options.issuer, subject: session.subject } : undefined);
    if (principal && session?.sessionId && this.options.sessionRegistry) await this.options.sessionRegistry.revoke(principal, session.sessionId);
    if (session?.refreshToken) await this.revokeRefreshToken(session.refreshToken);
    return this.clearSessionCookies();
  }

  /** Best effort: the cleared cookie and revoked registry entry already end the app session. */
  private async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      const endpoint = (await this.getMetadata()).revocation_endpoint;
      if (!endpoint) return;
      const form = new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token", client_id: this.options.clientId });
      if (this.options.clientSecret) form.set("client_secret", this.options.clientSecret);
      await this.fetcher(endpoint, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(5_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    } catch {
      // Provider revocation failures must not keep the browser signed in.
    }
  }

  private clearSessionCookies(response = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })): Response {
    response.headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, "", 0));
    response.headers.append("Set-Cookie", cookieHeader(FLOW_COOKIE, "", 0));
    return response;
  }

  private authFailure(
    code: OidcAuthenticationDiagnosticCode,
    details?: { providerError: OidcAuthenticationProviderError; providerStatus: number }
  ): Response {
    this.logDiagnostic({ event: "oidc_authentication_failure", route: "callback", code, ...(details ?? {}) });
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
    const value: ProviderEndpoints = { authorization_endpoint: metadata.authorization_endpoint, token_endpoint: metadata.token_endpoint };
    if (typeof metadata.revocation_endpoint === "string") {
      try {
        // Revocation is optional, so an unusable endpoint is ignored rather than failing sign-in.
        if (new URL(metadata.revocation_endpoint).protocol === "https:") value.revocation_endpoint = metadata.revocation_endpoint;
      } catch {
        // Ignore an invalid optional endpoint.
      }
    }
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

function validRefreshToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REFRESH_TOKEN_CHARS && !/[\s\u0000-\u001f]/.test(value);
}

/** Opens a structurally valid session cookie. A refreshable session may hold an expired access token. */
async function openSessionCookie(cookies: AuthCookieCodec, sealed: string, now: number): Promise<OidcSession | undefined> {
  const session = await cookies.open<OidcSession>(sealed, "session");
  if (!isObject(session) || typeof session.accessToken !== "string" || typeof session.expiresAt !== "number" ||
      !Number.isFinite(session.expiresAt) || session.expiresAt > now + MAX_SESSION_SECONDS * 1000) return;
  if (session.sessionId !== undefined && typeof session.sessionId !== "string") return;
  if (session.refreshToken === undefined) {
    return session.expiresAt > now ? { accessToken: session.accessToken, expiresAt: session.expiresAt,
      ...(session.sessionId ? { sessionId: session.sessionId } : {}) } : undefined;
  }
  if (!validRefreshToken(session.refreshToken) || typeof session.subject !== "string" || !session.subject ||
      typeof session.sessionExpiresAt !== "number" || session.sessionExpiresAt <= now ||
      session.sessionExpiresAt > now + REFRESHABLE_SESSION_SECONDS * 1000) return;
  return session;
}

function sessionCookieMaxAge(session: OidcSession, now: number): number {
  return Math.max(1, Math.floor(((session.sessionExpiresAt ?? session.expiresAt) - now) / 1000));
}

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
