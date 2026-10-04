import type { SyncD1Database } from "./d1-sync-store.ts";
import { validateIcsFeedUrl, fetchIcsFeed, type FeedResolver, type PinnedFeedTransport } from "./ics-fetch-security.ts";
import { parseIcsCalendar, type IcsCalendarEvent } from "./ics-calendar.ts";
import { validUuid } from "./device-registry.ts";
import { SyncRateLimitError, type SyncAuthenticator, type SyncPrincipal } from "./sync-api.ts";

export type IcsSubscription = {
  subscriptionId: string;
  calendarId: string;
  name: string;
  color: string;
  visible: boolean;
  lastRefreshAt?: string;
  nextRefreshAt: string;
  lastError?: "refresh_failed";
  events: IcsCalendarEvent[];
};

type IcsRow = {
  account_id: string; subscription_id: string; calendar_id: string; display_name: string; color: string; visible: number;
  encrypted_url: string; cache_json: string; etag: string | null; last_modified: string | null; last_attempt_at: string | null;
  last_refresh_at: string | null; next_refresh_at: string; failure_count: number; last_error_code: string | null;
  created_at: string; updated_at: string;
};

export class IcsSubscriptionError extends Error {
  readonly code: "invalid_subscription" | "subscription_not_found" | "too_many_subscriptions" | "refresh_throttled" | "subscription_conflict";
  constructor(code: IcsSubscriptionError["code"]) { super(code); this.code = code; }
}

/** D1 stores encrypted bearer URLs and bounded event caches; URL and event content never enter logs. */
export class D1IcsSubscriptionStore {
  private readonly db: SyncD1Database;
  private readonly encryptionKey: string;
  private readonly resolver: FeedResolver;
  private readonly transport: PinnedFeedTransport;
  private readonly now: () => number;

  constructor(db: SyncD1Database, encryptionKey: string, resolver: FeedResolver, transport: PinnedFeedTransport,
    now: () => number = Date.now) {
    this.db = db;
    this.encryptionKey = encryptionKey;
    this.resolver = resolver;
    this.transport = transport;
    this.now = now;
    decodeKey(encryptionKey);
  }

  async list(principal: SyncPrincipal): Promise<IcsSubscription[]> {
    const accountId = await this.accountId(principal);
    await this.limit(accountId);
    const result = await this.db.prepare(`SELECT * FROM ics_subscriptions WHERE account_id=? ORDER BY created_at,subscription_id`)
      .bind(accountId).all<IcsRow>();
    return (result.results ?? []).map(mapRecord);
  }

  async add(principal: SyncPrincipal, input: { calendarId: string; name: string; color: string; visible?: boolean; url: string }): Promise<IcsSubscription> {
    if (!validUuid(input.calendarId) || !validName(input.name) || !validColor(input.color) ||
        input.visible !== undefined && typeof input.visible !== "boolean") throw new IcsSubscriptionError("invalid_subscription");
    const url = subscriptionUrl(input.url);
    const accountId = await this.accountId(principal);
    await this.limit(accountId);
    const prior = await this.db.prepare("SELECT * FROM ics_subscriptions WHERE account_id=? AND calendar_id=?")
      .bind(accountId, input.calendarId).first<IcsRow>();
    if (prior) {
      if (await decryptUrl(prior.encrypted_url, this.encryptionKey) !== url.href) throw new IcsSubscriptionError("subscription_conflict");
      return mapRecord(prior);
    }
    const count = await this.db.prepare("SELECT COUNT(*) AS count FROM ics_subscriptions WHERE account_id=?")
      .bind(accountId).first<{ count: number }>();
    if ((count?.count ?? 0) >= 20) throw new IcsSubscriptionError("too_many_subscriptions");
    const now = new Date(this.now()).toISOString();
    const row = { account_id: accountId, subscription_id: crypto.randomUUID(), calendar_id: input.calendarId,
      display_name: input.name.trim(), color: input.color.toUpperCase(), visible: input.visible === false ? 0 : 1,
      encrypted_url: await encryptUrl(url.href, this.encryptionKey), cache_json: "[]", etag: null, last_modified: null,
      last_attempt_at: null, last_refresh_at: null, next_refresh_at: now, failure_count: 0, last_error_code: null,
      created_at: now, updated_at: now } satisfies IcsRow;
    await this.db.prepare(`INSERT INTO ics_subscriptions(account_id,subscription_id,calendar_id,display_name,color,visible,
      encrypted_url,cache_json,next_refresh_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(row.account_id, row.subscription_id, row.calendar_id, row.display_name, row.color, row.visible,
        row.encrypted_url, row.cache_json, row.next_refresh_at, row.created_at, row.updated_at).run();
    await this.refreshRow(row);
    return this.getByCalendarId(accountId, input.calendarId);
  }

  async update(principal: SyncPrincipal, subscriptionId: string, input: { name?: string; color?: string; visible?: boolean; url?: string }): Promise<IcsSubscription> {
    if (!validUuid(subscriptionId) || input.name !== undefined && !validName(input.name) ||
        input.color !== undefined && !validColor(input.color) || input.visible !== undefined && typeof input.visible !== "boolean" ||
        input.url !== undefined && typeof input.url !== "string") throw new IcsSubscriptionError("invalid_subscription");
    const accountId = await this.accountId(principal);
    await this.limit(accountId);
    const row = await this.getRow(accountId, subscriptionId);
    if (!row) throw new IcsSubscriptionError("subscription_not_found");
    const replacementUrl = input.url === undefined ? undefined : subscriptionUrl(input.url).href;
    const urlChanged = replacementUrl !== undefined && replacementUrl !== await decryptUrl(row.encrypted_url, this.encryptionKey);
    if (urlChanged && row.last_attempt_at && Date.parse(row.last_attempt_at) > this.now() - 5 * 60_000) {
      throw new IcsSubscriptionError("refresh_throttled");
    }
    const now = new Date(this.now()).toISOString();
    await this.db.prepare(`UPDATE ics_subscriptions SET display_name=?,color=?,visible=?,encrypted_url=?,
      next_refresh_at=CASE WHEN ? THEN ? ELSE next_refresh_at END,
      last_error_code=CASE WHEN ? THEN NULL ELSE last_error_code END,
      failure_count=CASE WHEN ? THEN 0 ELSE failure_count END,updated_at=? WHERE account_id=? AND subscription_id=?`)
      .bind(input.name?.trim() ?? row.display_name, input.color?.toUpperCase() ?? row.color,
        input.visible === undefined ? row.visible : input.visible ? 1 : 0,
        urlChanged ? await encryptUrl(replacementUrl!, this.encryptionKey) : row.encrypted_url,
        urlChanged ? 1 : 0, now, urlChanged ? 1 : 0, urlChanged ? 1 : 0, now, accountId, subscriptionId).run();
    if (urlChanged) {
      const updated = await this.getRow(accountId, subscriptionId);
      if (updated) await this.refreshRow(updated);
    }
    const latest = await this.getRow(accountId, subscriptionId);
    if (!latest) throw new IcsSubscriptionError("subscription_not_found");
    return mapRecord(latest);
  }

  async remove(principal: SyncPrincipal, subscriptionId: string): Promise<boolean> {
    if (!validUuid(subscriptionId)) throw new IcsSubscriptionError("invalid_subscription");
    const accountId = await this.accountId(principal);
    await this.limit(accountId);
    const result = await this.db.prepare("DELETE FROM ics_subscriptions WHERE account_id=? AND subscription_id=?")
      .bind(accountId, subscriptionId).run() as { meta?: { changes?: number }; changes?: number };
    return (result.meta?.changes ?? result.changes ?? 0) > 0;
  }

  async refresh(principal: SyncPrincipal, subscriptionId: string): Promise<IcsSubscription> {
    if (!validUuid(subscriptionId)) throw new IcsSubscriptionError("invalid_subscription");
    const accountId = await this.accountId(principal);
    await this.limit(accountId);
    const row = await this.getRow(accountId, subscriptionId);
    if (!row) throw new IcsSubscriptionError("subscription_not_found");
    if (row.last_attempt_at && Date.parse(row.last_attempt_at) > this.now() - 5 * 60_000) throw new IcsSubscriptionError("refresh_throttled");
    await this.refreshRow(row);
    const latest = await this.getRow(accountId, subscriptionId);
    if (!latest) throw new IcsSubscriptionError("subscription_not_found");
    return mapRecord(latest);
  }

  /** Worker cron refreshes a bounded batch of due feeds; failures are persisted with exponential backoff. */
  async refreshDue(limit = 5): Promise<{ attempted: number; refreshed: number; failed: number }> {
    const now = new Date(this.now()).toISOString();
    const due = await this.db.prepare("SELECT * FROM ics_subscriptions WHERE next_refresh_at<=? ORDER BY next_refresh_at,subscription_id LIMIT ?")
      .bind(now, Math.max(1, Math.min(25, Math.trunc(limit)))).all<IcsRow>();
    let refreshed = 0; let failed = 0;
    for (const row of due.results ?? []) {
      const result = await this.refreshRow(row);
      if (result) refreshed += 1; else failed += 1;
    }
    return { attempted: due.results?.length ?? 0, refreshed, failed };
  }

  private async refreshRow(row: IcsRow): Promise<boolean> {
    const now = this.now();
    const attemptedAt = new Date(now).toISOString();
    try {
      const url = await decryptUrl(row.encrypted_url, this.encryptionKey);
      const fetched = await fetchIcsFeed(url, this.resolver, this.transport, { etag: row.etag ?? undefined, lastModified: row.last_modified ?? undefined });
      const events = fetched.status === 304 ? JSON.parse(row.cache_json) as IcsCalendarEvent[] : parseIcsCalendar(fetched.body!,
        new Date(now - 30 * 86_400_000), new Date(now + 150 * 86_400_000));
      const nextRefresh = new Date(now + 6 * 60 * 60_000).toISOString();
      await this.db.prepare(`UPDATE ics_subscriptions SET cache_json=?,etag=?,last_modified=?,last_attempt_at=?,last_refresh_at=?,
        next_refresh_at=?,failure_count=0,last_error_code=NULL,updated_at=? WHERE account_id=? AND subscription_id=?`)
        .bind(JSON.stringify(events), fetched.etag ?? row.etag, fetched.lastModified ?? row.last_modified, attemptedAt,
          attemptedAt, nextRefresh, attemptedAt, row.account_id, row.subscription_id).run();
      return true;
    } catch {
      const failureCount = Math.min(16, row.failure_count + 1);
      const retryMinutes = Math.min(24 * 60, 15 * 2 ** Math.min(failureCount - 1, 7));
      await this.db.prepare(`UPDATE ics_subscriptions SET last_attempt_at=?,next_refresh_at=?,failure_count=?,last_error_code='refresh_failed',
        updated_at=? WHERE account_id=? AND subscription_id=?`)
        .bind(attemptedAt, new Date(now + retryMinutes * 60_000).toISOString(), failureCount, attemptedAt,
          row.account_id, row.subscription_id).run();
      return false;
    }
  }

  private async getByCalendarId(accountId: string, calendarId: string): Promise<IcsSubscription> {
    const row = await this.db.prepare("SELECT * FROM ics_subscriptions WHERE account_id=? AND calendar_id=?")
      .bind(accountId, calendarId).first<IcsRow>();
    if (!row) throw new IcsSubscriptionError("subscription_not_found");
    return mapRecord(row);
  }

  private async getRow(accountId: string, id: string): Promise<IcsRow | null> {
    return this.db.prepare("SELECT * FROM ics_subscriptions WHERE account_id=? AND subscription_id=?")
      .bind(accountId, id).first<IcsRow>();
  }

  private async accountId(principal: SyncPrincipal): Promise<string> {
    await this.db.prepare(`INSERT INTO sync_accounts(account_id,issuer,subject) VALUES(?,?,?)
      ON CONFLICT(issuer,subject) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
      .bind(crypto.randomUUID(), principal.issuer, principal.subject).run();
    const row = await this.db.prepare("SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?")
      .bind(principal.issuer, principal.subject).first<{ account_id: string }>();
    if (!row) throw new Error("Account lookup failed");
    return row.account_id;
  }

  private async limit(accountId: string): Promise<void> {
    const minute = new Date(this.now()).toISOString().slice(0, 16);
    const row = await this.db.prepare(`INSERT INTO sync_rate_limits(account_id,window_start,request_count) VALUES(?,?,1)
      ON CONFLICT(account_id) DO UPDATE SET request_count=CASE WHEN window_start=excluded.window_start THEN request_count+1 ELSE 1 END,
      window_start=excluded.window_start RETURNING request_count`).bind(accountId, minute).first<{ request_count: number }>();
    if ((row?.request_count ?? 121) > 120) throw new SyncRateLimitError();
  }
}

/** Account-protected same-origin JSON API; only encrypted source URLs remain server-side. */
export async function handleIcsSubscriptionRequest(request: Request, auth: SyncAuthenticator, store: D1IcsSubscriptionStore): Promise<Response> {
  const url = new URL(request.url);
  const prefix = "/api/v1/calendars/subscriptions";
  const rest = url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length + 1).split("/") : [];
  const collection = url.pathname === prefix;
  const id = rest[0];
  const refresh = rest.length === 2 && rest[1] === "refresh";
  if (!collection && (!id || rest.length > 2 || rest.length === 2 && !refresh)) return json({ error: "not_found" }, 404);
  const allowed = collection ? ["GET", "POST"].includes(request.method) :
    refresh ? request.method === "POST" : request.method === "DELETE" || request.method === "PATCH";
  if (!allowed) return json({ error: "method_not_allowed" }, 405);
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json({ error: "origin_rejected" }, 403);
  let principal: SyncPrincipal | undefined;
  try { principal = await auth.authenticate(request); }
  catch { return json({ error: "authentication_unavailable" }, 503); }
  if (!principal?.issuer || !principal.subject) return json({ error: "unauthorized" }, 401);
  try {
    if (request.method === "GET") return json({ subscriptions: await store.list(principal) });
    if (request.method === "DELETE") return json({ removed: await store.remove(principal, id!) });
    if (refresh) return json({ subscription: await store.refresh(principal, id!) });
    const body = await readBody(request);
    if (!body) return json({ error: "invalid_request" }, 400);
    if (request.method === "POST") {
      if (typeof body.calendarId !== "string" || typeof body.name !== "string" || typeof body.color !== "string" || typeof body.url !== "string" ||
          body.visible !== undefined && typeof body.visible !== "boolean") return json({ error: "invalid_subscription" }, 400);
      return json({ subscription: await store.add(principal, body as { calendarId: string; name: string; color: string; visible?: boolean; url: string }) }, 201);
    }
    if (typeof body.name !== "undefined" && typeof body.name !== "string" || typeof body.color !== "undefined" && typeof body.color !== "string" ||
        typeof body.visible !== "undefined" && typeof body.visible !== "boolean" || typeof body.url !== "undefined" && typeof body.url !== "string") return json({ error: "invalid_subscription" }, 400);
    return json({ subscription: await store.update(principal, id!, body as { name?: string; color?: string; visible?: boolean; url?: string }) });
  } catch (error) {
    if (error instanceof IcsSubscriptionError) {
      const status = error.code === "subscription_not_found" ? 404 : error.code === "refresh_throttled" ? 429 :
        error.code === "too_many_subscriptions" ? 409 : 400;
      return json({ error: error.code }, status, error.code === "refresh_throttled" ? { "Retry-After": "300" } : {});
    }
    if (error instanceof SyncRateLimitError) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    return json({ error: "calendar_subscriptions_unavailable" }, 503);
  }
}

function mapRecord(row: IcsRow): IcsSubscription {
  let events: IcsCalendarEvent[] = [];
  try {
    const value: unknown = JSON.parse(row.cache_json);
    if (Array.isArray(value)) events = value.filter(isIcsCalendarEvent);
  } catch { /* invalid cache fails closed to an empty calendar */ }
  return { subscriptionId: row.subscription_id, calendarId: row.calendar_id, name: row.display_name, color: row.color,
    visible: row.visible === 1, ...(row.last_refresh_at ? { lastRefreshAt: row.last_refresh_at } : {}),
    nextRefreshAt: row.next_refresh_at, ...(row.last_error_code === "refresh_failed" ? { lastError: "refresh_failed" as const } : {}), events };
}

function validName(value: string): boolean { return value.trim().length >= 1 && value.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(value); }
function validColor(value: string): boolean { return /^#[0-9a-f]{6}$/i.test(value); }
function isIcsCalendarEvent(value: unknown): value is IcsCalendarEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (typeof event.uid !== "string" || !event.uid || event.uid.length > 512 || typeof event.recurrenceId !== "string" ||
      !event.recurrenceId || event.recurrenceId.length > 512 || typeof event.title !== "string" || !event.title.trim() ||
      event.title.length > 240 || typeof event.start !== "string" || typeof event.end !== "string" || typeof event.allDay !== "boolean") return false;
  if (event.allDay) return validDate(event.start) && validDate(event.end) && event.end > event.start;
  return Number.isFinite(Date.parse(event.start)) && Number.isFinite(Date.parse(event.end)) && Date.parse(event.end) > Date.parse(event.start);
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function encryptUrl(url: string, keyString: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(decodeKey(keyString)), "AES-GCM", false, ["encrypt"]);
  const plaintext = new TextEncoder().encode(url);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: new TextEncoder().encode("ltm-ics-feed-url:v1") }, key, toArrayBuffer(plaintext));
  return `v1.${encode64(iv)}.${encode64(new Uint8Array(ciphertext))}`;
}

async function decryptUrl(value: string, keyString: string): Promise<string> {
  const [version, nonce, payload, extra] = value.split(".");
  if (version !== "v1" || !nonce || !payload || extra !== undefined) throw new Error("Calendar feed secret is invalid");
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(decodeKey(keyString)), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(decode64(nonce)), additionalData: new TextEncoder().encode("ltm-ics-feed-url:v1") },
    key, toArrayBuffer(decode64(payload)));
  const url = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  validateIcsFeedUrl(url);
  return url;
}

function decodeKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Calendar feed encryption key must be 32-byte base64url");
  const bytes = decode64(value);
  if (bytes.byteLength !== 32) throw new Error("Calendar feed encryption key must be 32-byte base64url");
  return bytes;
}
function encode64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decode64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encrypted data");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), part => part.charCodeAt(0));
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer { const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); return buffer; }

function subscriptionUrl(input: string): URL {
  try { return validateIcsFeedUrl(input); }
  catch { throw new IcsSubscriptionError("invalid_subscription"); }
}

function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Vary": "Cookie, Authorization", ...extra } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const declared = request.headers.get("Content-Length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 4_096) || !request.body ||
      !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_096) { await reader.cancel(); return; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return; }
}
