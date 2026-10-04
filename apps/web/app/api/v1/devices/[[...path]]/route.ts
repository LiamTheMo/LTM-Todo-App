import { env } from "cloudflare:workers";
import { OidcSessionAuthenticator } from "../../../../../lib/oidc-session.ts";
import { D1AuthSessionRegistry } from "../../../../../lib/auth-session-registry.ts";
import { DeviceRegistry } from "../../../../../lib/device-registry.ts";
import { handleDeviceRequest } from "../../../../../lib/device-api.ts";
import { SyncCursorCodec } from "../../../../../lib/sync-cursor.ts";
import { enforceEdgeRateLimit } from "../../../../../lib/edge-rate-limit.ts";

export const dynamic = "force-dynamic";

async function dispatch(request: Request) {
  const limited = await enforceEdgeRateLimit(request, env.SYNC_EDGE_LIMITER, "sync");
  if (limited) return limited;
  const { OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, OIDC_JWKS_URI: jwksUri,
    OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret, OIDC_REDIRECT_URI: redirectUri,
    AUTH_SESSION_SECRET: cookieSecret, SYNC_CURSOR_SECRET: cursorSecret } = env;
  if (!issuer || !audience || !jwksUri || !clientId || !redirectUri || !cookieSecret || !cursorSecret) {
    return Response.json({ error: "devices_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const auth = new OidcSessionAuthenticator({ issuer, audience, jwksUri, clientId, redirectUri, clientSecret, cookieSecret,
      sessionRegistry: new D1AuthSessionRegistry(env.SYNC_DB) });
    const registry = new DeviceRegistry(env.SYNC_DB, new SyncCursorCodec(cursorSecret));
    return await handleDeviceRequest(request, auth, registry);
  } catch {
    return Response.json({ error: "devices_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
