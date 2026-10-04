import type { SyncD1Database } from "./d1-sync-store.ts";

export const INACTIVE_DEVICE_RETENTION_DAYS = 180;
export const SYNC_JOURNAL_RETENTION_DAYS = 30;
export const IDEMPOTENCY_RETENTION_DAYS = 90;

type AccountRow = { account_id: string; change_sequence: number; min_available_sequence: number };
type RetentionCursorRow = { state_value: string };

/**
 * Retire dormant devices and compact journal/idempotency rows only after every active device has
 * acknowledged the change and the retention window elapsed. Minimal current-state tombstones stay
 * in sync_entities so a later snapshot cannot resurrect an old local record.
 */
export async function maintainSyncRetention(db: SyncD1Database, now = Date.now()): Promise<{ retiredDevices: number; compactedAccounts: number }> {
  const timestamp = new Date(now).toISOString();
  const deviceCutoff = new Date(now - INACTIVE_DEVICE_RETENTION_DAYS * 86_400_000).toISOString();
  const journalCutoff = new Date(now - SYNC_JOURNAL_RETENTION_DAYS * 86_400_000).toISOString();
  const idempotencyCutoff = new Date(now - IDEMPOTENCY_RETENTION_DAYS * 86_400_000).toISOString();
  const retiredResult = await db.prepare(`UPDATE sync_devices SET retired_at=? WHERE retired_at IS NULL AND last_seen_at<?`)
    .bind(timestamp, deviceCutoff).run() as { meta?: { changes?: number }; changes?: number };
  const savedCursor = await db.prepare("SELECT state_value FROM sync_retention_state WHERE state_key='accounts'").first<RetentionCursorRow>();
  const accounts = await db.prepare(`SELECT account_id,change_sequence,min_available_sequence FROM sync_accounts
    WHERE account_id>? ORDER BY account_id LIMIT 100`).bind(savedCursor?.state_value ?? "").all<AccountRow>();
  let compactedAccounts = 0;
  for (const account of accounts.results ?? []) {
    const active = await db.prepare(`SELECT MIN(acknowledged_sequence) AS sequence FROM sync_devices WHERE account_id=? AND retired_at IS NULL`)
      .bind(account.account_id).first<{ sequence: number | null }>();
    const safeThrough = active?.sequence ?? account.change_sequence;
    const candidate = await db.prepare(`SELECT MAX(sequence) AS sequence FROM sync_journal
      WHERE account_id=? AND sequence<=? AND created_at<?`).bind(account.account_id, safeThrough, journalCutoff)
      .first<{ sequence: number | null }>();
    const sequence = candidate?.sequence ?? 0;
    if (sequence <= account.min_available_sequence) continue;
    await db.batch([
      db.prepare(`UPDATE sync_accounts SET min_available_sequence=? WHERE account_id=? AND min_available_sequence<?`)
        .bind(sequence, account.account_id, sequence),
      db.prepare(`DELETE FROM sync_journal WHERE account_id=? AND sequence<=? AND created_at<?`)
        .bind(account.account_id, sequence, journalCutoff)
    ]);
    compactedAccounts += 1;
  }
  const processed = accounts.results ?? [];
  const nextCursor = processed.length === 100 ? processed.at(-1)!.account_id : "";
  await db.prepare(`INSERT INTO sync_retention_state(state_key,state_value) VALUES('accounts',?)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value`).bind(nextCursor).run();
  await db.prepare("DELETE FROM sync_idempotency WHERE created_at<?").bind(idempotencyCutoff).run();
  await db.prepare("DELETE FROM auth_sessions WHERE expires_at<? OR revoked_at<?")
    .bind(timestamp, new Date(now - 30 * 86_400_000).toISOString()).run();
  return { retiredDevices: retiredResult.meta?.changes ?? retiredResult.changes ?? 0, compactedAccounts };
}
