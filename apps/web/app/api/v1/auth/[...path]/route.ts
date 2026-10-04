import { env } from "cloudflare:workers";
import { OidcSessionService } from "../../../../../lib/oidc-session.ts";
import { D1AuthSessionRegistry } from "../../../../../lib/auth-session-registry.ts";
import { enforceEdgeRateLimit } from "../../../../../lib/edge-rate-limit.ts";

export const dynamic = "force-dynamic";

function unavailable() {
  return Response.json({ error: "authentication_not_configured" }, {
    status: 503, headers: { "Cache-Control": "no-store" }
  });
}

async function dispatch(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/v1/auth/login" || pathname === "/api/v1/auth/callback") {
    const limited = await enforceEdgeRateLimit(request, env.AUTH_EDGE_LIMITER, "auth");
    if (limited) return limited;
  }
  const { OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, OIDC_JWKS_URI: jwksUri,
    OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret, OIDC_REDIRECT_URI: redirectUri,
    AUTH_SESSION_SECRET: cookieSecret } = env;
  if (!issuer || !audience || !jwksUri || !clientId || !redirectUri || !cookieSecret) return unavailable();
  try {
    return await new OidcSessionService({ issuer, audience, jwksUri, clientId, clientSecret, redirectUri, cookieSecret,
      sessionRegistry: new D1AuthSessionRegistry(env.SYNC_DB) }).handle(request);
  } catch {
    return unavailable();
  }
}

export const GET = dispatch;
export const POST = dispatch;
