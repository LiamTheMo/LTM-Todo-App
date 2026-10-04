import { acknowledgeAttachmentUpload, bindSyncAccount, readPendingAttachmentUploads, type PendingAttachmentUpload } from "./storage.ts";

export type AttachmentUploadSyncResult = { uploaded: number; pending: number; blocked?: "offline" | "sign_in" | "account_mismatch" | "service" };
type UploadOutbox = {
  pending(): Promise<PendingAttachmentUpload[]>;
  acknowledge(id: string): Promise<void>;
  bindAccount(accountKey: string): Promise<boolean>;
};

/** Uploads a bounded batch; IndexedDB is acknowledged only after the server confirms a durable write. */
export async function syncPendingAttachmentUploads(options: {
  outbox?: UploadOutbox;
  fetcher?: typeof fetch;
  online?: boolean;
  batchSize?: number;
} = {}): Promise<AttachmentUploadSyncResult> {
  const online = options.online ?? (typeof navigator === "undefined" || navigator.onLine);
  const outbox = options.outbox ?? { pending: readPendingAttachmentUploads, acknowledge: acknowledgeAttachmentUpload, bindAccount: bindSyncAccount };
  const items = await outbox.pending();
  if (!items.length) return { uploaded: 0, pending: 0 };
  if (!online) return { uploaded: 0, pending: items.length, blocked: "offline" };
  const fetcher = options.fetcher ?? fetch;
  try {
    const session = await fetcher("/api/v1/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (session.status === 401) return { uploaded: 0, pending: items.length, blocked: "sign_in" };
    if (!session.ok) return { uploaded: 0, pending: items.length, blocked: "service" };
    const account = await session.json() as { authenticated?: unknown; accountKey?: unknown };
    if (account.authenticated !== true) return { uploaded: 0, pending: items.length, blocked: "sign_in" };
    if (typeof account.accountKey !== "string" || !await outbox.bindAccount(account.accountKey)) {
      return { uploaded: 0, pending: items.length, blocked: "account_mismatch" };
    }
  } catch { return { uploaded: 0, pending: items.length, blocked: "service" }; }
  let uploaded = 0;
  let blocked: AttachmentUploadSyncResult["blocked"];
  for (const item of items.slice(0, Math.max(1, Math.min(10, options.batchSize ?? 3)))) {
    try {
      const response = await fetcher("/api/v1/attachments", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": item.mediaType, "X-LTM-Task-Id": item.taskId,
          "X-LTM-File-Name": encodeURIComponent(item.fileName), "Idempotency-Key": item.uploadId }, body: item.blob });
      if (response.status === 401) { blocked = "sign_in"; break; }
      if (!response.ok) { blocked = "service"; break; }
      await outbox.acknowledge(item.id);
      uploaded += 1;
    } catch { blocked = typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "service"; break; }
  }
  return { uploaded, pending: Math.max(0, items.length - uploaded), ...(blocked ? { blocked } : {}) };
}
