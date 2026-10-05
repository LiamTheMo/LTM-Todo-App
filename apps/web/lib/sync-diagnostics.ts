export type SyncStep = "session" | "local_storage" | "device_registration" | "snapshot" | "upload" | "download" | "cursor";
const failureCodes = ["unauthorized", "authentication_unavailable", "devices_not_configured", "devices_unavailable",
  "sync_not_configured", "sync_unavailable", "invalid_relationship", "mutation_id_reused", "rate_limited",
  "invalid_request", "invalid_entity", "invalid_cursor", "unsupported_protocol", "unsupported_schema",
  "request_too_large", "database_schema_missing", "storage_quota_exceeded", "storage_unavailable",
  "coordinator_unavailable", "network_error", "local_storage_unavailable", "invalid_response"] as const;
export type SyncFailureCode = typeof failureCodes[number];
export type SyncFailure = { step: SyncStep; status?: number; code?: SyncFailureCode };

export class SyncBackendError extends Error {
  readonly code: SyncFailureCode;
  constructor(code: SyncFailureCode) { super("Account storage unavailable"); this.code = code; }
}

export function safeSyncFailureCode(value: unknown): SyncFailureCode | undefined {
  return typeof value === "string" && failureCodes.includes(value as SyncFailureCode) ? value as SyncFailureCode : undefined;
}

/** Log only fixed categories. Database errors can include SQL, identifiers, or user content. */
export function logSyncBackendFailure(operation: string, error: unknown): SyncFailureCode {
  const message = error instanceof Error ? error.message : "";
  const code = error instanceof SyncBackendError ? error.code : /no such (?:table|column)|has no column named/i.test(message) ? "database_schema_missing" :
    /quota|daily.*limit|database or disk is full|SQLITE_FULL/i.test(message) ? "storage_quota_exceeded" :
    /D1_ERROR|D1 database|database.*unavailable/i.test(message) ? "storage_unavailable" : "sync_unavailable";
  console.error(JSON.stringify({ event: "sync_failure", operation, code }));
  return code;
}

export function describeSyncFailure(failure: SyncFailure): string {
  if (failure.code === "database_schema_missing") return "Cloud storage needs a database update.";
  if (failure.code === "storage_quota_exceeded") return "Cloud storage has reached its service limit.";
  if (failure.code === "local_storage_unavailable") return "Unable to read or update this device's sync storage.";
  if (failure.code === "invalid_relationship") return "Some records could not be linked to their calendars or tasks.";
  if (failure.code === "rate_limited" || failure.status === 429) return "The server asked this device to wait before syncing.";
  if (failure.code === "network_error") return "Unable to reach account storage.";
  const step = { session: "verify the account", local_storage: "prepare this device's data",
    device_registration: "register this device", snapshot: "load account data", upload: "save changes to the account",
    download: "load account changes", cursor: "confirm downloaded changes" }[failure.step];
  return `Unable to ${step}.`;
}
