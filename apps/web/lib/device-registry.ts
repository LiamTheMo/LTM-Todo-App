import type { SyncD1Database } from "./d1-sync-store.ts";
import type { SyncPrincipal } from "./sync-api.ts";
import { SyncCursorCodec } from "./sync-cursor.ts";

export type SyncDevice = {
  deviceId: string;
  displayName: string;
  clientKind: "web" | "apple";
  acknowledgedSequence: number;
  createdAt: string;
  lastSeenAt: string;
  retiredAt?: string;
};

type DeviceRow = {
  device_id: string; display_name: string; client_kind: "web" | "apple"; acknowledged_sequence: number;
  created_at: string; last_seen_at: string; retired_at: string | null;
};

export class SyncDeviceError extends Error {
  readonly code: "invalid_device" | "device_retired" | "invalid_cursor" | "cursor_regression";
  constructor(code: "invalid_device" | "device_retired" | "invalid_cursor" | "cursor_regression") {
    super(code);
    this.code = code;
  }
}

/** Account-scoped registration and cursor acknowledgements used for device recovery/retirement. */
export class DeviceRegistry {
  private readonly db: SyncD1Database;
  private readonly cursors: SyncCursorCodec;
  constructor(db: SyncD1Database, cursors: SyncCursorCodec) { this.db = db; this.cursors = cursors; }

  async list(principal: SyncPrincipal): Promise<SyncDevice[]> {
    const accountId = await this.accountId(principal);
    const result = await this.db.prepare(`SELECT device_id,display_name,client_kind,acknowledged_sequence,created_at,last_seen_at,retired_at
      FROM sync_devices WHERE account_id=? ORDER BY retired_at IS NOT NULL,last_seen_at DESC,device_id`).bind(accountId).all<DeviceRow>();
    return (result.results ?? []).map(row => ({ deviceId: row.device_id, displayName: row.display_name,
      clientKind: row.client_kind, acknowledgedSequence: row.acknowledged_sequence, createdAt: row.created_at,
      lastSeenAt: row.last_seen_at, ...(row.retired_at ? { retiredAt: row.retired_at } : {}) }));
  }

  async isActive(principal: SyncPrincipal, deviceId: string): Promise<boolean> {
    if (!validUuid(deviceId)) return false;
    const accountId = await this.accountId(principal);
    const result = await this.db.prepare(`UPDATE sync_devices SET last_seen_at=? WHERE account_id=? AND device_id=? AND retired_at IS NULL`)
      .bind(new Date().toISOString(), accountId, deviceId).run() as { meta?: { changes?: number }; changes?: number };
    return (result.meta?.changes ?? result.changes ?? 0) > 0;
  }

  async register(principal: SyncPrincipal, input: { deviceId: string; displayName: string; clientKind: "web" | "apple" }): Promise<SyncDevice> {
    if (!validUuid(input.deviceId) || !validName(input.displayName) || !["web", "apple"].includes(input.clientKind)) {
      throw new SyncDeviceError("invalid_device");
    }
    const accountId = await this.accountId(principal);
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO sync_devices(account_id,device_id,display_name,client_kind,last_seen_at)
      VALUES(?,?,?,?,?) ON CONFLICT(account_id,device_id) DO UPDATE SET
      display_name=excluded.display_name,client_kind=excluded.client_kind,last_seen_at=excluded.last_seen_at
      WHERE sync_devices.retired_at IS NULL`).bind(accountId, input.deviceId, input.displayName.trim(), input.clientKind, now).run();
    const row = await this.db.prepare(`SELECT device_id,display_name,client_kind,acknowledged_sequence,created_at,last_seen_at,retired_at
      FROM sync_devices WHERE account_id=? AND device_id=?`).bind(accountId, input.deviceId).first<DeviceRow>();
    if (!row) throw new SyncDeviceError("device_retired");
    if (row.retired_at) throw new SyncDeviceError("device_retired");
    return { deviceId: row.device_id, displayName: row.display_name, clientKind: row.client_kind,
      acknowledgedSequence: row.acknowledged_sequence, createdAt: row.created_at, lastSeenAt: row.last_seen_at };
  }

  async acknowledge(principal: SyncPrincipal, deviceId: string, cursor: string): Promise<number> {
    if (!validUuid(deviceId) || typeof cursor !== "string" || cursor.length > 1024) throw new SyncDeviceError("invalid_device");
    const accountId = await this.accountId(principal);
    let sequence: number;
    try { sequence = await this.cursors.decode(cursor, accountId); }
    catch { throw new SyncDeviceError("invalid_cursor"); }
    const account = await this.db.prepare("SELECT change_sequence FROM sync_accounts WHERE account_id=?")
      .bind(accountId).first<{ change_sequence: number }>();
    if (!account || sequence > account.change_sequence) throw new SyncDeviceError("invalid_cursor");
    const current = await this.db.prepare("SELECT acknowledged_sequence,retired_at FROM sync_devices WHERE account_id=? AND device_id=?")
      .bind(accountId, deviceId).first<{ acknowledged_sequence: number; retired_at: string | null }>();
    if (!current || current.retired_at) throw new SyncDeviceError("device_retired");
    if (sequence < current.acknowledged_sequence) throw new SyncDeviceError("cursor_regression");
    await this.db.prepare(`UPDATE sync_devices SET acknowledged_sequence=?,last_seen_at=?
      WHERE account_id=? AND device_id=? AND retired_at IS NULL`).bind(sequence, new Date().toISOString(), accountId, deviceId).run();
    return sequence;
  }

  async retire(principal: SyncPrincipal, deviceId: string): Promise<boolean> {
    if (!validUuid(deviceId)) throw new SyncDeviceError("invalid_device");
    const accountId = await this.accountId(principal);
    const result = await this.db.prepare(`UPDATE sync_devices SET retired_at=?,last_seen_at=?
      WHERE account_id=? AND device_id=? AND retired_at IS NULL`).bind(new Date().toISOString(), new Date().toISOString(), accountId, deviceId).run() as {
        meta?: { changes?: number }; changes?: number;
      };
    return (result.meta?.changes ?? result.changes ?? 0) > 0;
  }

  private async accountId(principal: SyncPrincipal): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare(`INSERT INTO sync_accounts(account_id,issuer,subject) VALUES(?,?,?)
      ON CONFLICT(issuer,subject) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
      .bind(id, principal.issuer, principal.subject).run();
    const row = await this.db.prepare("SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?")
      .bind(principal.issuer, principal.subject).first<{ account_id: string }>();
    if (!row) throw new Error("Account lookup failed");
    return row.account_id;
  }
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
}
