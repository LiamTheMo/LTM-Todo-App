import { env } from "cloudflare:workers";
import { D1AuthSessionRegistry } from "../../../../../../lib/auth-session-registry.ts";
import { enforceEdgeRateLimit } from "../../../../../../lib/edge-rate-limit.ts";
import { OidcSessionAuthenticator } from "../../../../../../lib/oidc-session.ts";
import { CloudflarePinnedFeedTransport, cloudflareFeedResolver } from "../../../../../../lib/cloudflare-pinned-feed-transport.ts";
import { D1IcsSubscriptionStore, handleIcsSubscriptionRequest } from "../../../../../../lib/ics-subscriptions.ts";

export const dynamic = "force-dynamic";

async function dispatch(request: Request) {
  const limited = await enforceEdgeRateLimit(request, env.SYNC_EDGE_LIMITER, "sync");
  if (limited) return limited;
  const { OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, OIDC_JWKS_URI: jwksUri, OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret, OIDC_REDIRECT_URI: redirectUri, AUTH_SESSION_SECRET: cookieSecret,
    ICS_FEED_ENCRYPTION_KEY: encryptionKey } = env;
  if (!issuer || !audience || !jwksUri || !clientId || !redirectUri || !cookieSecret || !encryptionKey) {
    return Response.json({ error: "calendar_subscriptions_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const auth = new OidcSessionAuthenticator({ issuer, audience, jwksUri, clientId, clientSecret, redirectUri, cookieSecret,
      sessionRegistry: new D1AuthSessionRegistry(env.SYNC_DB) });
    const store = new D1IcsSubscriptionStore(env.SYNC_DB, encryptionKey, cloudflareFeedResolver, new CloudflarePinnedFeedTransport());
    return await handleIcsSubscriptionRequest(request, auth, store);
  } catch {
    return Response.json({ error: "calendar_subscriptions_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
