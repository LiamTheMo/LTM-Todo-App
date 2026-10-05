import {
  MAX_SYNC_BODY_BYTES, MAX_SYNC_RESPONSE_BYTES, SYNC_CLIENT_SCHEMA_VERSION, parseSyncPullQuery, parseSyncPushBatch,
  type SyncPushBatch
} from "./sync-protocol.ts";
import type { SyncSnapshotResponse } from "./d1-sync-store.ts";
import { logSyncBackendFailure } from "./sync-diagnostics.ts";

export type SyncPrincipal = { issuer: string; subject: string };
export type SyncChange = {
  entityType: string;
  entityId: string;
  revision: number;
  updatedAt: string;
  deletedAt?: string;
  payload?: Record<string, unknown>;
};
export type PushResult =
  | { clientMutationId: string; status: "accepted"; revision: number; cursor: string }
  | { clientMutationId: string; status: "conflict"; current?: SyncChange };
export type PushResponse = { protocolVersion: 1; entitySchemaVersion: typeof SYNC_CLIENT_SCHEMA_VERSION; results: PushResult[] };
export type PullResponse = { protocolVersion: 1; entitySchemaVersion: typeof SYNC_CLIENT_SCHEMA_VERSION; changes: SyncChange[]; cursor?: string; hasMore: boolean };

/** Implementations must scope every query and cursor to accountId and apply push batches transactionally. */
export interface SyncStore {
  push(principal: SyncPrincipal, batch: SyncPushBatch): Promise<PushResponse>;
  pull(principal: SyncPrincipal, cursor: string | undefined, limit: number): Promise<PullResponse>;
}

export interface SyncSnapshotStore {
  snapshot(principal: SyncPrincipal, cursor: string | undefined, limit: number): Promise<SyncSnapshotResponse>;
}

export interface SyncAuthenticator {
  authenticate(request: Request): Promise<SyncPrincipal | undefined>;
}

export class InvalidSyncCursorError extends Error {}
export class SyncMutationConflictError extends Error {
  constructor() { super("Mutation ID was reused with different contents"); }
}
export class SyncRateLimitError extends Error {
  constructor() { super("Sync request rate limit exceeded"); }
}
export class InvalidSyncRelationshipError extends Error {
  constructor(message = "Invalid entity relationship") { super(message); }
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  const serialized = JSON.stringify(body);
  const responseTooLarge = typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > MAX_SYNC_RESPONSE_BYTES;
  return new Response(responseTooLarge ? JSON.stringify({ error: "sync_unavailable" }) : serialized, { status: responseTooLarge ? 503 : status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Authorization, Cookie",
      "X-LTM-Sync-Protocol": "1", ...extraHeaders } });
}

async function readBoundedJson(request: Request): Promise<{ value?: unknown; bytes?: number; failure?: "too_large" | "invalid" }> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_SYNC_BODY_BYTES)) return { failure: "too_large" };
  if (!request.body) return { failure: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SYNC_BODY_BYTES) {
        await reader.cancel();
        return { failure: "too_large" };
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)), bytes };
  } catch {
    return { failure: "invalid" };
  }
}

/** Provider-neutral HTTP boundary; production authentication and persistence are injected. */
export async function handleSyncRequest(request: Request, auth: SyncAuthenticator, store: SyncStore): Promise<Response> {
  const path = new URL(request.url).pathname;
  const isPush = path === "/api/v1/sync/push";
  const isPull = path === "/api/v1/sync/changes";
  if (!isPush && !isPull) return json({ error: "not_found" }, 404);
  if ((isPush && request.method !== "POST") || (isPull && request.method !== "GET")) {
    return json({ error: "method_not_allowed" }, 405);
  }

  let principal: SyncPrincipal | undefined;
  try { principal = await auth.authenticate(request); }
  catch { return json({ error: "authentication_unavailable" }, 503); }
  if (!principal?.issuer || !principal.subject) return json({ error: "unauthorized" }, 401);
  if (request.headers.get("X-LTM-Sync-Protocol") !== "1") return json({ error: "unsupported_protocol" }, 426);

  if (isPush) {
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "content_type_required" }, 415);
    }
    const body = await readBoundedJson(request);
    if (body.failure === "too_large") return json({ error: "request_too_large" }, 413);
    if (body.failure || body.bytes === undefined) return json({ error: "invalid_request" }, 400);
    const parsed = parseSyncPushBatch(body.value, body.bytes);
    if (!parsed.ok) {
      const status = parsed.code === "unsupported_protocol" || parsed.code === "unsupported_schema" ? 426 :
        parsed.code === "request_too_large" ? 413 : 400;
      return json({ error: parsed.code }, status);
    }
    try { return json(await store.push(principal, parsed.value)); }
    catch (error) {
      if (error instanceof SyncMutationConflictError) return json({ error: "mutation_id_reused" }, 409);
      if (error instanceof InvalidSyncRelationshipError) return json({ error: "invalid_relationship" }, 409);
      if (error instanceof SyncRateLimitError) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
      return json({ error: logSyncBackendFailure("upload", error) }, 503);
    }
  }

  const query = parseSyncPullQuery(new URL(request.url));
  if (!query.ok) return json({ error: query.code }, 400);
  try { return json(await store.pull(principal, query.value.cursor, query.value.limit)); }
  catch (error) {
    if (error instanceof InvalidSyncCursorError) return json({ error: "invalid_cursor" }, 410);
    return json({ error: logSyncBackendFailure("download", error) }, 503);
  }
}

/** Initial and recovery sync uses a stable, bounded snapshot before resuming the change journal. */
export async function handleSyncSnapshotRequest(request: Request, auth: SyncAuthenticator, store: SyncSnapshotStore): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/v1/sync/snapshot") return json({ error: "not_found" }, 404);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  let principal: SyncPrincipal | undefined;
  try { principal = await auth.authenticate(request); }
  catch { return json({ error: "authentication_unavailable" }, 503); }
  if (!principal?.issuer || !principal.subject) return json({ error: "unauthorized" }, 401);
  if (request.headers.get("X-LTM-Sync-Protocol") !== "1") return json({ error: "unsupported_protocol" }, 426);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const rawLimit = url.searchParams.get("limit") ?? "12";
  if (url.searchParams.size > 2 || !/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 12 ||
      cursor !== undefined && (!cursor || cursor.length > 1024)) return json({ error: "invalid_query" }, 400);
  try { return json(await store.snapshot(principal, cursor, Number(rawLimit))); }
  catch (error) {
    if (error instanceof InvalidSyncCursorError) return json({ error: "invalid_cursor" }, 410);
    return json({ error: logSyncBackendFailure("snapshot", error) }, 503);
  }
}
