import { normalizeData } from "./storage.ts";
import type { Data } from "./domain.ts";

export const BACKUP_FORMAT = "ltm-todo-backup" as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  schemaVersion: number;
  data: Data;
};

export function createBackup(data: Data, exportedAt = new Date().toISOString()): BackupFile {
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error("Invalid backup export time");
  const normalized = normalizeData(data);
  const backup: BackupFile = { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt,
    schemaVersion: normalized.schemaVersion, data: normalized };
  if (new TextEncoder().encode(JSON.stringify(backup)).byteLength > MAX_BACKUP_BYTES) throw new Error("Backup is larger than 16 MB");
  return backup;
}

/** Parse and fully validate a backup before the caller can replace any current data. */
export function parseBackup(text: string): Data {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("Backup file is larger than 16 MB");
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch { throw new Error("Backup file is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Backup file is malformed");
  const backup = value as Record<string, unknown>;
  if (backup.format !== BACKUP_FORMAT || backup.formatVersion !== BACKUP_FORMAT_VERSION ||
      typeof backup.exportedAt !== "string" || !Number.isFinite(Date.parse(backup.exportedAt)) ||
      !Number.isSafeInteger(backup.schemaVersion) || typeof backup.data !== "object" || backup.data === null || Array.isArray(backup.data)) {
    throw new Error("Backup format or version is not supported");
  }
  if ((backup.data as Record<string, unknown>).schemaVersion !== backup.schemaVersion) throw new Error("Backup schema version does not match its data");
  const data = normalizeData(backup.data);
  if (data.schemaVersion !== 4) throw new Error("Backup data schema is not supported");
  return data;
}
