import type { SyncMutation } from "./sync-protocol.ts";
import type { SyncChange } from "./sync-api.ts";

export type PendingLocalChange = { mutation: SyncMutation; queuedAt: number };

/** Latest of a record's edit and soft-delete stamps; NaN when neither is a valid timestamp. */
function editTime(record: Record<string, unknown> | undefined): number {
  const times = ["updatedAt", "deletedAt"].map(field => typeof record?.[field] === "string" ? Date.parse(record[field] as string) : NaN)
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : NaN;
}

const isDeleted = (payload: Record<string, unknown> | undefined) => typeof payload?.deletedAt === "string" && payload.deletedAt !== "";

/**
 * Chooses which side of a sync conflict to keep without asking.
 * - An edit always beats a deletion, whichever is newer, so no device's work is discarded; the record stays.
 * - Deletions on both sides keep the server copy; nothing needs pushing.
 * - Two edits: the most recent edit wins. Ties and undated local edits keep the server copy, so every device
 *   converges on the same value.
 */
export function conflictWinner(local: PendingLocalChange, remote?: SyncChange): "local" | "remote" {
  if (!remote) return "local";
  const localDeleted = local.mutation.operation === "delete" || isDeleted(local.mutation.payload);
  const remoteDeleted = Boolean(remote.deletedAt) || isDeleted(remote.payload);
  if (localDeleted || remoteDeleted) return localDeleted ? "remote" : "local";
  const localTime = editTime(local.mutation.payload);
  const remoteEdit = editTime(remote.payload);
  const remoteTime = Number.isFinite(remoteEdit) ? remoteEdit : Date.parse(remote.updatedAt);
  if (!Number.isFinite(localTime)) return "remote";
  if (!Number.isFinite(remoteTime)) return "local";
  return localTime > remoteTime ? "local" : "remote";
}
