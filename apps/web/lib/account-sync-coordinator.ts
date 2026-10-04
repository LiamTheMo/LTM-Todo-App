import { SyncCursorCodec } from "./sync-cursor.ts";
import { D1SyncStore, type SyncD1Database } from "./d1-sync-store.ts";
import { InvalidSyncCursorError, InvalidSyncRelationshipError, SyncMutationConflictError, SyncRateLimitError,
  type SyncPrincipal } from "./sync-api.ts";

type CoordinatorEnv = { SYNC_DB: SyncD1Database; SYNC_CURSOR_SECRET: string };
type Operation = { kind: "push"; principal: SyncPrincipal; batch: Parameters<D1SyncStore["push"]>[1] } |
  { kind: "pull"; principal: SyncPrincipal; cursor?: string; limit: number } |
  { kind: "snapshot"; principal: SyncPrincipal; cursor?: string; limit: number };

/** Serializes sync operations for one authenticated account before they touch D1. */
export class AccountSyncCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly store: D1SyncStore;
  constructor(_state: unknown, env: CoordinatorEnv) {
    this.store = new D1SyncStore(env.SYNC_DB, new SyncCursorCodec(env.SYNC_CURSOR_SECRET));
  }
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "not_found" }, { status: 404 });
    let operation: Operation;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object") throw new Error();
      operation = parsed as Operation;
      if (!operation.principal?.issuer || !operation.principal?.subject ||
          !["push", "pull", "snapshot"].includes(operation.kind)) throw new Error();
    } catch { return Response.json({ error: "invalid_internal_request" }, { status: 400 }); }
    const result = this.tail.then(async () => {
      try {
        const value = operation.kind === "push"
          ? await this.store.push(operation.principal, operation.batch)
          : operation.kind === "pull" ? await this.store.pull(operation.principal, operation.cursor, operation.limit)
            : await this.store.snapshot(operation.principal, operation.cursor, operation.limit);
        return Response.json(value, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        const code = error instanceof SyncMutationConflictError ? "mutation_id_reused" :
          error instanceof InvalidSyncRelationshipError ? "invalid_relationship" :
          error instanceof SyncRateLimitError ? "rate_limited" :
          error instanceof InvalidSyncCursorError ? "invalid_cursor" : "sync_unavailable";
        const status = code === "mutation_id_reused" || code === "invalid_relationship" ? 409 :
          code === "rate_limited" ? 429 : code === "invalid_cursor" ? 410 : 503;
        return Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
      }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
