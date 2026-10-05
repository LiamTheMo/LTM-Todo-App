import { env } from "cloudflare:workers";
import { OidcSessionAuthenticator } from "../../../../../lib/oidc-session.ts";
import { D1AuthSessionRegistry } from "../../../../../lib/auth-session-registry.ts";
import { handleSyncRequest, InvalidSyncCursorError, InvalidSyncRelationshipError, SyncMutationConflictError,
  handleSyncSnapshotRequest, SyncRateLimitError, type PullResponse, type PushResponse, type SyncPrincipal, type SyncStore } from "../../../../../lib/sync-api.ts";
import { enforceEdgeRateLimit } from "../../../../../lib/edge-rate-limit.ts";
import { DeviceRegistry } from "../../../../../lib/device-registry.ts";
import type { SyncSnapshotResponse } from "../../../../../lib/d1-sync-store.ts";
import { SyncCursorCodec } from "../../../../../lib/sync-cursor.ts";
import type { SyncPushBatch } from "../../../../../lib/sync-protocol.ts";
import { logSyncBackendFailure, safeSyncFailureCode, SyncBackendError } from "../../../../../lib/sync-diagnostics.ts";

export const dynamic = "force-dynamic";

function unavailable() {
  return Response.json({ error: "sync_not_configured" }, {
    status: 503, headers: { "Cache-Control": "no-store" }
  });
}

class CoordinatorStore implements SyncStore {
  async push(principal: SyncPrincipal, batch: SyncPushBatch): Promise<PushResponse> {
    return this.call(principal, { kind: "push", principal, batch }) as Promise<PushResponse>;
  }
  async pull(principal: SyncPrincipal, cursor: string | undefined, limit: number): Promise<PullResponse> {
    return this.call(principal, { kind: "pull", principal, cursor, limit }) as Promise<PullResponse>;
  }
  async snapshot(principal: SyncPrincipal, cursor: string | undefined, limit: number): Promise<SyncSnapshotResponse> {
    return this.call(principal, { kind: "snapshot", principal, cursor, limit }) as unknown as Promise<SyncSnapshotResponse>;
  }
  private async call(principal: SyncPrincipal, payload: unknown): Promise<PushResponse | PullResponse> {
    const material = new TextEncoder().encode(`${principal.issuer}\u0000${principal.subject}`);
    const digest = await crypto.subtle.digest("SHA-256", material);
    const coordinatorName = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const id = env.SYNC_COORDINATOR.idFromName(coordinatorName);
    const response = await env.SYNC_COORDINATOR.get(id).fetch(new Request("https://sync-coordinator.internal/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    }));
    const body = await response.json() as { error?: string };
    if (!response.ok) {
      if (body.error === "mutation_id_reused") throw new SyncMutationConflictError();
      if (body.error === "invalid_relationship") throw new InvalidSyncRelationshipError();
      if (body.error === "rate_limited") throw new SyncRateLimitError();
      if (body.error === "invalid_cursor") throw new InvalidSyncCursorError();
      throw new SyncBackendError(safeSyncFailureCode(body.error) ?? "coordinator_unavailable");
    }
    return body as PushResponse | PullResponse;
  }
}

async function dispatch(request: Request) {
  const limited = await enforceEdgeRateLimit(request, env.SYNC_EDGE_LIMITER, "sync");
  if (limited) return limited;
  const issuer = env.OIDC_ISSUER;
  const audience = env.OIDC_AUDIENCE;
  const jwksUri = env.OIDC_JWKS_URI;
  const clientId = env.OIDC_CLIENT_ID;
  const redirectUri = env.OIDC_REDIRECT_URI;
  const authSessionSecret = env.AUTH_SESSION_SECRET;
  const cursorSecret = env.SYNC_CURSOR_SECRET;
  if (!issuer || !audience || !jwksUri || !clientId || !redirectUri || !authSessionSecret || !cursorSecret) return unavailable();
  try {
    const baseAuth = new OidcSessionAuthenticator({ issuer, audience, jwksUri, clientId, redirectUri,
      clientSecret: env.OIDC_CLIENT_SECRET, cookieSecret: authSessionSecret,
      sessionRegistry: new D1AuthSessionRegistry(env.SYNC_DB) });
    const devices = new DeviceRegistry(env.SYNC_DB, new SyncCursorCodec(cursorSecret));
    const auth = { async authenticate(syncRequest: Request) {
      const principal = await baseAuth.authenticate(syncRequest);
      const deviceId = syncRequest.headers.get("X-LTM-Sync-Device");
      return principal && deviceId && await devices.isActive(principal, deviceId) ? principal : undefined;
    } };
    const store = new CoordinatorStore();
    return new URL(request.url).pathname === "/api/v1/sync/snapshot"
      ? await handleSyncSnapshotRequest(request, auth, store)
      : await handleSyncRequest(request, auth, store);
  } catch (error) {
    return Response.json({ error: logSyncBackendFailure("sync_dispatch", error) }, {
      status: 503, headers: { "Cache-Control": "no-store" }
    });
  }
}

export const GET = dispatch;
export const POST = dispatch;
