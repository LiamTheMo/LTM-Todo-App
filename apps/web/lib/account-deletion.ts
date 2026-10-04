import type { SyncD1Database } from "./d1-sync-store.ts";
import type { SyncAuthenticator, SyncPrincipal } from "./sync-api.ts";

export class D1AccountDeletionStore {
  private readonly db: SyncD1Database;

  constructor(db: SyncD1Database) {
    this.db = db;
  }

  /** Content rows cascade immediately; a durable, non-FK job later drains the private R2 prefix. */
  async delete(principal: SyncPrincipal): Promise<boolean> {
    const account = await this.db.prepare("SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?")
      .bind(principal.issuer, principal.subject).first<{ account_id: string }>();
    if (!account) return false;
    await this.db.batch([
      this.db.prepare("INSERT OR IGNORE INTO account_deletion_jobs(account_id) VALUES(?)").bind(account.account_id),
      this.db.prepare("DELETE FROM sync_accounts WHERE account_id=?").bind(account.account_id)
    ]);
    return true;
  }
}

export async function handleAccountDeletionRequest(request: Request, auth: SyncAuthenticator, store: D1AccountDeletionStore): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/v1/account/delete") return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("Origin") !== url.origin) return json({ error: "origin_rejected" }, 403);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ error: "content_type_required" }, 415);
  let principal: SyncPrincipal | undefined;
  try { principal = await auth.authenticate(request); }
  catch { return json({ error: "authentication_unavailable" }, 503); }
  if (!principal?.issuer || !principal.subject) return json({ error: "unauthorized" }, 401);
  let body: unknown;
  try {
    const declared = request.headers.get("Content-Length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1_024) || !request.body) return json({ error: "invalid_request" }, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_024) { await reader.cancel(); return json({ error: "invalid_request" }, 400); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return json({ error: "invalid_request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as Record<string, unknown>).confirmation !== "DELETE") {
    return json({ error: "confirmation_required" }, 400);
  }
  try {
    await store.delete(principal);
    return json({ deleted: true, attachmentCleanup: "pending" }, 202, {
      "Set-Cookie": "__Host-ltm-session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
    });
  } catch { return json({ error: "account_deletion_unavailable" }, 503); }
}

function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Vary": "Cookie, Authorization", ...extra } });
}
