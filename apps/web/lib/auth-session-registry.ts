import type { SyncD1Database } from "./d1-sync-store.ts";
import type { SyncPrincipal } from "./sync-api.ts";

export type ActiveAuthSession = { sessionKey: string; createdAt: string; expiresAt: string; lastSeenAt: string; current: boolean };
export interface AuthSessionRegistry {
  issue(principal: SyncPrincipal, sessionId: string, expiresAt: number): Promise<void>;
  isActive(principal: SyncPrincipal, sessionId: string): Promise<boolean>;
  list(principal: SyncPrincipal, currentSessionId: string): Promise<ActiveAuthSession[]>;
  revoke(principal: SyncPrincipal, sessionId: string): Promise<boolean>;
  revokeAll(principal: SyncPrincipal, exceptSessionId?: string): Promise<number>;
}

type SessionRow = { session_id_hash: string; created_at: string; expires_at: string; last_seen_at: string };

/** Only a one-way hash of the encrypted-cookie session ID is persisted, so leaked DB rows cannot forge a cookie. */
export class D1AuthSessionRegistry implements AuthSessionRegistry {
  private readonly db: SyncD1Database;
  private readonly now: () => number;

  constructor(db: SyncD1Database, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  async issue(principal: SyncPrincipal, sessionId: string, expiresAt: number): Promise<void> {
    const accountId = await this.ensureAccount(principal);
    await this.db.prepare("INSERT INTO auth_sessions(account_id,session_id_hash,expires_at) VALUES(?,?,?)")
      .bind(accountId, await hashSessionId(sessionId), new Date(expiresAt).toISOString()).run();
  }

  async isActive(principal: SyncPrincipal, sessionId: string): Promise<boolean> {
    if (!validSessionId(sessionId)) return false;
    const account = await this.findAccount(principal);
    if (!account) return false;
    const hash = await hashSessionId(sessionId);
    const now = new Date(this.now()).toISOString();
    const row = await this.db.prepare(`SELECT session_id_hash FROM auth_sessions
      WHERE account_id=? AND session_id_hash=? AND revoked_at IS NULL AND expires_at>?`)
      .bind(account.account_id, hash, now).first<{ session_id_hash: string }>();
    if (!row) return false;
    await this.db.prepare(`UPDATE auth_sessions SET last_seen_at=? WHERE account_id=? AND session_id_hash=?
      AND last_seen_at<?`).bind(now, account.account_id, hash, new Date(this.now() - 60_000).toISOString()).run();
    return true;
  }

  async list(principal: SyncPrincipal, currentSessionId: string): Promise<ActiveAuthSession[]> {
    const account = await this.findAccount(principal);
    if (!account) return [];
    const result = await this.db.prepare(`SELECT session_id_hash,created_at,expires_at,last_seen_at FROM auth_sessions
      WHERE account_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY last_seen_at DESC LIMIT 100`)
      .bind(account.account_id, new Date(this.now()).toISOString()).all<SessionRow>();
    const currentHash = await hashSessionId(currentSessionId);
    return (result.results ?? []).map(row => ({ sessionKey: row.session_id_hash, createdAt: row.created_at,
      expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, current: row.session_id_hash === currentHash }));
  }

  async revoke(principal: SyncPrincipal, sessionId: string): Promise<boolean> {
    const account = await this.findAccount(principal);
    if (!account || !validSessionId(sessionId) && !/^[0-9a-f]{64}$/.test(sessionId)) return false;
    const result = await this.db.prepare(`UPDATE auth_sessions SET revoked_at=? WHERE account_id=? AND session_id_hash=? AND revoked_at IS NULL`)
      .bind(new Date(this.now()).toISOString(), account.account_id, /^[0-9a-f]{64}$/.test(sessionId) ? sessionId : await hashSessionId(sessionId)).run() as {
        meta?: { changes?: number }; changes?: number;
      };
    return (result.meta?.changes ?? result.changes ?? 0) > 0;
  }

  async revokeAll(principal: SyncPrincipal, exceptSessionId?: string): Promise<number> {
    const account = await this.findAccount(principal);
    if (!account) return 0;
    const except = exceptSessionId && validSessionId(exceptSessionId) ? await hashSessionId(exceptSessionId) : undefined;
    const result = await this.db.prepare(`UPDATE auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL
      AND expires_at>? AND (? IS NULL OR session_id_hash<>?)`)
      .bind(new Date(this.now()).toISOString(), account.account_id, new Date(this.now()).toISOString(), except ?? null, except ?? null).run() as {
        meta?: { changes?: number }; changes?: number;
      };
    return result.meta?.changes ?? result.changes ?? 0;
  }

  private async findAccount(principal: SyncPrincipal): Promise<{ account_id: string } | null> {
    return this.db.prepare("SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?")
      .bind(principal.issuer, principal.subject).first<{ account_id: string }>();
  }

  private async ensureAccount(principal: SyncPrincipal): Promise<string> {
    await this.db.prepare(`INSERT INTO sync_accounts(account_id,issuer,subject) VALUES(?,?,?)
      ON CONFLICT(issuer,subject) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
      .bind(crypto.randomUUID(), principal.issuer, principal.subject).run();
    const account = await this.findAccount(principal);
    if (!account) throw new Error("Account lookup failed");
    return account.account_id;
  }
}

function validSessionId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
async function hashSessionId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
