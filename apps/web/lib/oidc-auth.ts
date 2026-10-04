import type { SyncAuthenticator, SyncPrincipal } from "./sync-api.ts";

type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown; crit?: unknown };
type JwtClaims = { iss?: unknown; sub?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown; iat?: unknown; azp?: unknown; nonce?: unknown };
type OidcJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type JwkSet = { keys?: OidcJwk[] };
type SupportedAlgorithm = "RS256" | "ES256";

export type OidcVerifierOptions = {
  issuer: string;
  audience: string;
  jwksUri: string;
  fetcher?: typeof fetch;
  now?: () => number;
  cacheMilliseconds?: number;
};

const MAX_TOKEN_CHARS = 8_192;
const MAX_JWKS_BYTES = 64_000;
const CLOCK_SKEW_SECONDS = 30;
const base64Url = /^[A-Za-z0-9_-]+$/;
const asRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

function decodePart(value: string): Uint8Array {
  if (!value || !base64Url.test(value)) throw new Error("Invalid token encoding");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T {
  const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodePart(value)));
  if (!asRecord(result)) throw new Error("Invalid token object");
  return result as T;
}

function supportedAlgorithm(value: unknown): value is SupportedAlgorithm {
  return value === "RS256" || value === "ES256";
}

function audienceMatches(claim: unknown, expected: string): boolean {
  if (typeof claim === "string") return claim === expected;
  return Array.isArray(claim) && claim.length > 0 && claim.every(item => typeof item === "string") && claim.includes(expected);
}

function importAlgorithm(algorithm: SupportedAlgorithm): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams {
  return algorithm === "RS256"
    ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
    : { name: "ECDSA", namedCurve: "P-256" };
}

function verifyAlgorithm(algorithm: SupportedAlgorithm): AlgorithmIdentifier | EcdsaParams {
  return algorithm === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
}

function keyMatchesAlgorithm(key: OidcJwk, algorithm: SupportedAlgorithm): boolean {
  if (algorithm === "RS256") {
    if (key.kty !== "RSA" || typeof key.n !== "string") return false;
    try { return decodePart(key.n).byteLength >= 256; } catch { return false; }
  }
  return key.kty === "EC" && key.crv === "P-256";
}

export class OidcJwtAuthenticator implements SyncAuthenticator {
  private readonly options: OidcVerifierOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly cacheMilliseconds: number;
  private cachedKeys?: { expiresAt: number; keys: OidcJwk[] };

  constructor(options: OidcVerifierOptions) {
    this.options = options;
    const issuer = new URL(options.issuer);
    const jwks = new URL(options.jwksUri);
    if (issuer.protocol !== "https:" || jwks.protocol !== "https:" || !options.audience.trim()) {
      throw new Error("OIDC issuer, JWKS URI, and audience must be configured with HTTPS");
    }
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheMilliseconds = Math.min(Math.max(options.cacheMilliseconds ?? 15 * 60_000, 60_000), 60 * 60_000);
  }

  async authenticate(request: Request): Promise<SyncPrincipal | undefined> {
    const authorization = request.headers.get("Authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match || match[1].length > MAX_TOKEN_CHARS) return;
    try { return await this.verifyToken(match[1]); }
    catch (error) {
      if (error instanceof JwksUnavailableError) throw error;
      return;
    }
  }

  async verifyToken(token: string, expectedNonce?: string): Promise<SyncPrincipal | undefined> {
    if (!token || token.length > MAX_TOKEN_CHARS) return;
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(part => !part)) return;
    let header: JwtHeader;
    let claims: JwtClaims;
    try {
      header = decodeJsonPart<JwtHeader>(parts[0]);
      claims = decodeJsonPart<JwtClaims>(parts[1]);
    } catch { return; }

    if (!supportedAlgorithm(header.alg) || typeof header.kid !== "string" || !header.kid ||
        header.kid.length > 256 || header.crit !== undefined ||
        (header.typ !== undefined && header.typ !== "JWT" && header.typ !== "at+jwt")) return;
    if (claims.iss !== this.options.issuer || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 512 ||
        !audienceMatches(claims.aud, this.options.audience) || !Number.isFinite(claims.exp)) return;
    if (expectedNonce !== undefined && (typeof claims.nonce !== "string" || claims.nonce !== expectedNonce)) return;
    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== this.options.audience) return;
    const nowSeconds = Math.floor(this.now() / 1000);
    if ((claims.exp as number) <= nowSeconds - CLOCK_SKEW_SECONDS ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || (claims.nbf as number) > nowSeconds + CLOCK_SKEW_SECONDS)) ||
        (claims.iat !== undefined && (!Number.isFinite(claims.iat) || (claims.iat as number) > nowSeconds + CLOCK_SKEW_SECONDS))) return;

    const matchingKey = (keys: OidcJwk[]) => keys.find(item => item.kid === header.kid &&
      (item.alg === undefined || item.alg === header.alg) && (item.use === undefined || item.use === "sig") &&
      keyMatchesAlgorithm(item, header.alg as SupportedAlgorithm));
    let key = matchingKey(await this.getKeys(false));
    if (!key) key = matchingKey(await this.getKeys(true));
    if (!key) return;
    try {
      const imported = await crypto.subtle.importKey("jwk", key, importAlgorithm(header.alg), false, ["verify"]);
      const signedContent = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const valid = await crypto.subtle.verify(verifyAlgorithm(header.alg), imported,
        toArrayBuffer(decodePart(parts[2])), toArrayBuffer(signedContent));
      return valid ? { issuer: this.options.issuer, subject: claims.sub } : undefined;
    } catch { return; }
  }

  private async getKeys(forceRefresh: boolean): Promise<OidcJwk[]> {
    if (!forceRefresh && this.cachedKeys && this.cachedKeys.expiresAt > this.now()) return this.cachedKeys.keys;
    let response: Response;
    try { response = await this.fetcher(this.options.jwksUri, { redirect: "manual", signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" } }); }
    catch { throw new JwksUnavailableError(); }
    if (!response.ok) throw new JwksUnavailableError();
    const length = Number(response.headers.get("Content-Length") ?? 0);
    if (length > MAX_JWKS_BYTES) throw new JwksUnavailableError();
    let jwks: JwkSet;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing key response");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_JWKS_BYTES) {
          await reader.cancel();
          throw new Error("Key response too large");
        }
        chunks.push(value);
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      jwks = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as JwkSet;
    } catch { throw new JwksUnavailableError(); }
    const kids = new Set<string>();
    if (!Array.isArray(jwks.keys) || jwks.keys.length > 32 || jwks.keys.some(key => {
      if (!key || typeof key.kid !== "string" || !key.kid || key.kid.length > 256 || kids.has(key.kid)) return true;
      kids.add(key.kid);
      return false;
    })) {
      throw new JwksUnavailableError();
    }
    this.cachedKeys = { keys: jwks.keys, expiresAt: this.now() + this.cacheMilliseconds };
    return jwks.keys;
  }
}

class JwksUnavailableError extends Error {
  constructor() { super("Identity provider signing keys are unavailable"); }
}
