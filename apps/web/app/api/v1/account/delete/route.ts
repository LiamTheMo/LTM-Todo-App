import { env } from "cloudflare:workers";
import { D1AccountDeletionStore, handleAccountDeletionRequest } from "../../../../../lib/account-deletion.ts";
import { D1AuthSessionRegistry } from "../../../../../lib/auth-session-registry.ts";
import { enforceEdgeRateLimit } from "../../../../../lib/edge-rate-limit.ts";
import { OidcSessionAuthenticator } from "../../../../../lib/oidc-session.ts";

export const dynamic = "force-dynamic";

async function dispatch(request: Request) {
  const limited = await enforceEdgeRateLimit(request, env.SYNC_EDGE_LIMITER, "sync");
  if (limited) return limited;
  const { OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, OIDC_JWKS_URI: jwksUri, OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret, OIDC_REDIRECT_URI: redirectUri, AUTH_SESSION_SECRET: cookieSecret } = env;
  if (!issuer || !audience || !jwksUri || !clientId || !redirectUri || !cookieSecret) {
    return Response.json({ error: "account_deletion_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const auth = new OidcSessionAuthenticator({ issuer, audience, jwksUri, clientId, clientSecret, redirectUri, cookieSecret,
      sessionRegistry: new D1AuthSessionRegistry(env.SYNC_DB) });
    return await handleAccountDeletionRequest(request, auth, new D1AccountDeletionStore(env.SYNC_DB));
  } catch {
    return Response.json({ error: "account_deletion_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const POST = dispatch;
