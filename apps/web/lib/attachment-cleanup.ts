import { env } from "cloudflare:workers";
import { D1R2AttachmentStore } from "./d1-r2-attachments.ts";
import { maintainSyncRetention } from "./sync-retention.ts";

/** Drains private object deletion retries from the Worker cron without logging keys or user data. */
export async function dispatchAttachmentCleanup(): Promise<void> {
  await maintainSyncRetention(env.SYNC_DB);
  const bucket = env.ATTACHMENTS_BUCKET;
  if (!bucket) return;
  const store = new D1R2AttachmentStore(env.SYNC_DB, bucket, Number.MAX_SAFE_INTEGER);
  await store.processCleanup(50);
  await store.processAccountDeletionJobs(2);
  await store.reconcileOrphans(100);
}
