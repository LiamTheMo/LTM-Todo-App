import { MAX_SYNC_BATCH, SYNC_CLIENT_SCHEMA_VERSION, SYNC_PROTOCOL_VERSION, type SyncMutation } from "./sync-protocol.ts";
import type { PullResponse, PushResponse, SyncChange } from "./sync-api.ts";
import { safeSyncFailureCode, type SyncFailure, type SyncFailureCode, type SyncStep } from "./sync-diagnostics.ts";

export type ClientSyncStatus = "idle" | "checking" | "syncing" | "offline" | "signed_out" | "account_mismatch" | "device_retired" | "error" | "conflict";
export type SyncOutbox = {
  bindAccount(accountKey: string): Promise<boolean>;
  prepareUpload(): Promise<void>;
  pending(limit: number): Promise<SyncMutation[]>;
  acknowledge(mutation: SyncMutation, revision: number): Promise<void>;
  recordConflict(mutation: SyncMutation, current?: SyncChange): Promise<void>;
  cursor(): Promise<string | undefined>;
  setCursor(cursor: string | undefined): Promise<void>;
  snapshotCursor(): Promise<string | undefined>;
  setSnapshotCursor(cursor: string | undefined): Promise<void>;
  applyRemote(changes: SyncChange[]): Promise<void>;
  hasConflicts(): Promise<boolean>;
};
export type SyncStatus = { state: ClientSyncStatus; authenticated?: boolean; lastSuccessAt?: string; retryAt?: string; failure?: SyncFailure };
export type SyncClientOptions = {
  fetcher?: typeof fetch;
  outbox: SyncOutbox;
  onStatus?: (status: SyncStatus) => void;
  online?: () => boolean;
  now?: () => number;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  deviceId?: string;
  deviceName?: string;
};

const jsonHeaders = { "Content-Type": "application/json", "X-LTM-Sync-Protocol": String(SYNC_PROTOCOL_VERSION) };
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Local writes stay authoritative; this worker only reads the durable journal after the IndexedDB commit. */
export class SyncClient {
  private readonly fetcher: typeof fetch;
  private readonly outbox: SyncOutbox;
  private readonly onStatus: (status: SyncStatus) => void;
  private readonly online: () => boolean;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private deviceId: string;
  private readonly deviceName: string;
  private running = false;
  private requested = false;
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private authenticated = false;
  private step: SyncStep = "session";
  private status: SyncStatus = { state: "idle" };

  constructor(options: SyncClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.outbox = options.outbox;
    this.onStatus = options.onStatus ?? (() => undefined);
    this.online = options.online ?? (() => typeof navigator === "undefined" || navigator.onLine);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.deviceId = options.deviceId ?? getLocalSyncDeviceId();
    this.deviceName = options.deviceName ?? "This browser";
  }

  getStatus() { return this.status; }

  /** Explicitly re-register a retired install with a fresh ID without touching its local task data. */
  async reRegisterRetiredDevice(): Promise<void> {
    if (this.status.state !== "device_retired") return;
    this.deviceId = rotateLocalSyncDeviceId();
    await this.syncNow();
  }

  async syncNow(): Promise<void> {
    if (this.running) { this.requested = true; return; }
    this.running = true;
    this.clearScheduled();
    try {
      do {
        this.requested = false;
        await this.synchronizeOnce();
      } while (this.requested && this.online());
      this.failures = 0;
      const conflict = await this.localStorage(() => this.outbox.hasConflicts());
      this.publish({ state: conflict ? "conflict" : "idle", lastSuccessAt: new Date(this.now()).toISOString() });
    } catch (error) {
      const status = error instanceof SyncHttpError && error.status === 401 ? "signed_out" : this.online() ? "error" : "offline";
      if (error instanceof SyncAccountMismatchError) this.publish({ state: "account_mismatch" });
      else if (error instanceof SyncDeviceRetiredError) this.publish({ state: "device_retired" });
      else if (status === "signed_out") { this.authenticated = false; this.publish({ state: status }); }
      else this.scheduleRetry(status, error instanceof SyncHttpError ? error.retryAfterMs : undefined, {
        step: this.step, ...(error instanceof SyncHttpError ? { status: error.status, code: error.code } :
          { code: this.step === "local_storage" ? "local_storage_unavailable" :
            error instanceof SyncResponseError ? "invalid_response" : "network_error" })
      });
    } finally {
      this.running = false;
      if (this.requested && this.online()) void this.syncNow();
    }
  }

  dispose(): void { this.clearScheduled(); }

  private async synchronizeOnce(): Promise<void> {
    if (!this.online()) throw new SyncOfflineError();
    this.publish({ state: "checking" });
    const session = await this.fetchRequest("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin" });
    if (session.status === 401) throw new SyncHttpError(401);
    if (!session.ok) throw await SyncHttpError.fromResponse(session);
    const account = await session.json() as { authenticated?: unknown; accountKey?: unknown };
    if (account.authenticated !== true) throw new SyncHttpError(401);
    this.authenticated = true;
    this.step = "local_storage";
    if (typeof account.accountKey !== "string" || !await this.localStorage(() => this.outbox.bindAccount(account.accountKey as string))) throw new SyncAccountMismatchError();

    const registration = await this.fetchRequest("/api/v1/devices", { method: "POST", cache: "no-store", credentials: "same-origin",
      headers: jsonHeaders, body: JSON.stringify({ deviceId: this.deviceId, displayName: this.deviceName, clientKind: "web" }) });
    if (registration.status === 410) throw new SyncDeviceRetiredError();
    if (!registration.ok) throw await SyncHttpError.fromResponse(registration);

    this.publish({ state: "syncing" });
    if (!await this.localStorage(() => this.outbox.cursor())) await this.pullSnapshot();
    this.step = "local_storage";
    await this.outbox.prepareUpload();
    while (true) {
      const mutations = await this.localStorage(() => this.outbox.pending(MAX_SYNC_BATCH));
      if (!mutations.length) break;
      const response = await this.fetchRequest("/api/v1/sync/push", {
        method: "POST", cache: "no-store", credentials: "same-origin", headers: { ...jsonHeaders, "X-LTM-Sync-Device": this.deviceId },
        body: JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, mutations })
      });
      if (!response.ok) throw await SyncHttpError.fromResponse(response);
      const result = await response.json() as PushResponse;
      if (result.protocolVersion !== SYNC_PROTOCOL_VERSION || result.entitySchemaVersion !== SYNC_CLIENT_SCHEMA_VERSION ||
          !Array.isArray(result.results) || result.results.length !== mutations.length) throw new SyncResponseError("Invalid sync push response");
      const byId = new Map(result.results.map(item => [item.clientMutationId, item]));
      for (const mutation of mutations) {
        const outcome = byId.get(mutation.clientMutationId);
        if (!outcome) throw new SyncResponseError("Incomplete sync push response");
        if (outcome.status === "accepted" && Number.isSafeInteger(outcome.revision) && outcome.revision > 0) {
          await this.localStorage(() => this.outbox.acknowledge(mutation, outcome.revision));
        } else if (outcome.status === "conflict") {
          await this.localStorage(() => this.outbox.recordConflict(mutation, outcome.current));
        } else throw new SyncResponseError("Invalid sync push result");
      }
      if (result.results.some(item => item.status === "conflict")) break;
    }

    let cursor = await this.localStorage(() => this.outbox.cursor());
    while (true) {
      const query = new URLSearchParams({ limit: "12" });
      if (cursor) query.set("cursor", cursor);
      const response = await this.fetchRequest(`/api/v1/sync/changes?${query}`, {
        cache: "no-store", credentials: "same-origin", headers: { "X-LTM-Sync-Protocol": String(SYNC_PROTOCOL_VERSION), "X-LTM-Sync-Device": this.deviceId }
      });
      if (response.status === 410) {
        await this.outbox.setCursor(undefined);
        await this.outbox.setSnapshotCursor(undefined);
        await this.pullSnapshot();
        cursor = await this.outbox.cursor();
        continue;
      }
      if (!response.ok) throw await SyncHttpError.fromResponse(response);
      const page = await response.json() as PullResponse;
      if (page.protocolVersion !== SYNC_PROTOCOL_VERSION || page.entitySchemaVersion !== SYNC_CLIENT_SCHEMA_VERSION ||
          !Array.isArray(page.changes) || typeof page.cursor !== "string" || typeof page.hasMore !== "boolean") throw new SyncResponseError("Invalid sync pull response");
      await this.localStorage(async () => {
        await this.outbox.applyRemote(page.changes);
        await this.outbox.setCursor(page.cursor);
      });
      cursor = page.cursor;
      const acknowledged = await this.fetchRequest(`/api/v1/devices/${this.deviceId}/cursor`, { method: "PUT", cache: "no-store",
        credentials: "same-origin", headers: jsonHeaders, body: JSON.stringify({ cursor: page.cursor }) });
      if (!acknowledged.ok) throw await SyncHttpError.fromResponse(acknowledged);
      if (!page.hasMore) break;
    }
  }

  private async pullSnapshot(): Promise<void> {
    let snapshotCursor = await this.outbox.snapshotCursor();
    let restarted = false;
    while (true) {
      const query = new URLSearchParams({ limit: "12" });
      if (snapshotCursor) query.set("cursor", snapshotCursor);
      const response = await this.fetchRequest(`/api/v1/sync/snapshot?${query}`, {
        cache: "no-store", credentials: "same-origin", headers: { "X-LTM-Sync-Protocol": String(SYNC_PROTOCOL_VERSION),
          "X-LTM-Sync-Device": this.deviceId }
      });
      if (response.status === 410 && !restarted) {
        restarted = true;
        snapshotCursor = undefined;
        await this.outbox.setSnapshotCursor(undefined);
        continue;
      }
      if (!response.ok) throw await SyncHttpError.fromResponse(response);
      const page = await response.json() as { protocolVersion?: unknown; entitySchemaVersion?: unknown; changes?: unknown;
        complete?: unknown; snapshotCursor?: unknown; cursor?: unknown };
      if (page.protocolVersion !== SYNC_PROTOCOL_VERSION || page.entitySchemaVersion !== SYNC_CLIENT_SCHEMA_VERSION ||
          !Array.isArray(page.changes) || typeof page.complete !== "boolean") throw new SyncResponseError("Invalid sync snapshot response");
      await this.localStorage(() => this.outbox.applyRemote(page.changes as SyncChange[]));
      if (page.complete) {
        if (typeof page.cursor !== "string") throw new SyncResponseError("Invalid sync snapshot cursor");
        await this.outbox.setCursor(page.cursor);
        await this.outbox.setSnapshotCursor(undefined);
        await this.acknowledgeCursor(page.cursor);
        return;
      }
      if (typeof page.snapshotCursor !== "string") throw new SyncResponseError("Invalid sync snapshot continuation");
      snapshotCursor = page.snapshotCursor;
      await this.outbox.setSnapshotCursor(snapshotCursor);
    }
  }

  private async acknowledgeCursor(cursor: string): Promise<void> {
    const response = await this.fetchRequest(`/api/v1/devices/${this.deviceId}/cursor`, { method: "PUT", cache: "no-store",
      credentials: "same-origin", headers: jsonHeaders, body: JSON.stringify({ cursor }) });
    if (!response.ok) throw await SyncHttpError.fromResponse(response);
  }

  private async localStorage<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { this.step = "local_storage"; throw error; }
  }

  private scheduleRetry(state: "offline" | "error", serverDelay?: number, failure?: SyncFailure): void {
    const delay = serverDelay ?? Math.min(5 * 60_000, 1_000 * 2 ** Math.min(this.failures++, 8));
    const jittered = Math.round(delay * (0.8 + this.random() * 0.4));
    const retryAt = this.now() + jittered;
    this.publish({ state, retryAt: new Date(retryAt).toISOString(), failure });
    this.timer = this.setTimer(() => { this.timer = undefined; void this.syncNow(); }, jittered);
  }

  private async fetchRequest(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const path = String(input);
    this.step = path.includes("auth/session") ? "session" : path.includes("/cursor") ? "cursor" :
      path.includes("/devices") ? "device_registration" : path.includes("/snapshot") ? "snapshot" :
        path.includes("/push") ? "upload" : "download";
    const controller = new AbortController();
    const timer = this.setTimer(() => controller.abort(), 10_000);
    try { return await this.fetcher(input, { ...init, signal: controller.signal }); }
    finally { this.clearTimer(timer); }
  }

  private clearScheduled(): void { if (this.timer !== undefined) this.clearTimer(this.timer); this.timer = undefined; }
  private publish(status: SyncStatus): void {
    this.status = { ...status, authenticated: this.authenticated };
    this.onStatus(this.status);
  }
}

export class SyncHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly code?: SyncFailureCode;
  constructor(status: number, retryAfterMs?: number, code?: SyncFailureCode) {
    super("Sync request failed"); this.status = status; this.retryAfterMs = retryAfterMs; this.code = code;
  }
  static async fromResponse(response: Response): Promise<SyncHttpError> {
    let code: SyncFailureCode | undefined;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 4096) { await reader.cancel(); break; }
          chunks.push(value);
        }
        if (length <= 4096) {
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          code = safeSyncFailureCode((JSON.parse(new TextDecoder().decode(bytes)) as { error?: unknown })?.error);
        }
      } catch { /* A proxy or invalid body must not hide the HTTP status. */ }
    }
    return new SyncHttpError(response.status, retryAfter(response), code);
  }
}
class SyncResponseError extends Error {}
class SyncAccountMismatchError extends Error {}
class SyncOfflineError extends Error {}
class SyncDeviceRetiredError extends Error {}

let ephemeralSyncDeviceId: string | undefined;
export function getLocalSyncDeviceId(): string {
  const key = "ltm.sync.device-id.v1";
  try {
    const current = globalThis.localStorage?.getItem(key);
    if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)) return current;
    const created = ephemeralSyncDeviceId ?? crypto.randomUUID();
    ephemeralSyncDeviceId = created;
    globalThis.localStorage?.setItem(key, created);
    return created;
  } catch { ephemeralSyncDeviceId ??= crypto.randomUUID(); return ephemeralSyncDeviceId; }
}

function rotateLocalSyncDeviceId(): string {
  const next = crypto.randomUUID();
  ephemeralSyncDeviceId = next;
  try { globalThis.localStorage?.setItem("ltm.sync.device-id.v1", next); } catch { /* this session retains the new ID */ }
  return next;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.min(milliseconds, 5 * 60_000) : undefined;
}
