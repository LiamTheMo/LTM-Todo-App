import { env } from "cloudflare:workers";
import { OidcSessionAuthenticator } from "../../../../../lib/oidc-session.ts";
import { D1AuthSessionRegistry } from "../../../../../lib/auth-session-registry.ts";
import { D1R2AttachmentStore } from "../../../../../lib/d1-r2-attachments.ts";
import { handleAttachmentRequest } from "../../../../../lib/attachment-api.ts";
import { enforceEdgeRateLimit } from "../../../../../lib/edge-rate-limit.ts";

export const dynamic = "force-dynamic";

function unavailable() {
  return Response.json({ error: "attachments_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

async function dispatch(request: Request) {
  const limited = await enforceEdgeRateLimit(request, env.SYNC_EDGE_LIMITER, "sync");
  if (limited) return limited;
  const { OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, OIDC_JWKS_URI: jwksUri,
    OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret, OIDC_REDIRECT_URI: redirectUri,
    AUTH_SESSION_SECRET: cookieSecret } = env;
  const bucket = env.ATTACHMENTS_BUCKET;
  if (!issuer || !audience || !jwksUri || !clientId || !redirectUri || !cookieSecret || !bucket) return unavailable();
  try {
    const auth = new OidcSessionAuthenticator({ issuer, audience, jwksUri, clientId, redirectUri,
      clientSecret, cookieSecret, sessionRegistry: new D1AuthSessionRegistry(env.SYNC_DB) });
    return await handleAttachmentRequest(request, auth,
      new D1R2AttachmentStore(env.SYNC_DB, bucket));
  } catch { return unavailable(); }
}

export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
