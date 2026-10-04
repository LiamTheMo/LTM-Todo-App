import { AttachmentRequestError, MAX_ATTACHMENT_BYTES, type AttachmentRecord, type AttachmentStore } from "./attachment-api.ts";
import { SyncRateLimitError, type SyncPrincipal } from "./sync-api.ts";
import type { SyncD1Database } from "./d1-sync-store.ts";

type Metadata = { attachment_id: string; task_id: string; file_name: string; media_type: string; byte_size: number;
  sha256: string; created_at: string; object_key: string };
type PrivateObjectBucket = {
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
  delete(key: string): Promise<void>;
  list(options: { limit: number; cursor?: string; prefix?: string }): Promise<{ objects: Array<{ key: string; uploaded: Date }>; truncated: boolean; cursor?: string }>;
};
function map(row: Metadata): AttachmentRecord {
  return { id: row.attachment_id, taskId: row.task_id, fileName: row.file_name, mediaType: row.media_type,
    size: Number(row.byte_size), sha256: row.sha256, createdAt: new Date(row.created_at).toISOString() };
}
function asBuffer(bytes: Uint8Array): ArrayBuffer { const value = new ArrayBuffer(bytes.byteLength); new Uint8Array(value).set(bytes); return value; }

/** D1 metadata + private R2 objects. Object keys are generated and never accepted from clients. */
export class D1R2AttachmentStore implements AttachmentStore {
  private readonly db: SyncD1Database;
  private readonly bucket: PrivateObjectBucket;
  private readonly requestsPerMinute: number;
  constructor(db: SyncD1Database, bucket: PrivateObjectBucket, requestsPerMinute = 120) {
    this.db = db; this.bucket = bucket; this.requestsPerMinute = requestsPerMinute;
  }
  async list(principal: SyncPrincipal): Promise<AttachmentRecord[]> {
    const accountId = await this.account(principal); await this.limit(accountId);
    const result = await this.db.prepare(`SELECT attachment_id,task_id,file_name,media_type,byte_size,sha256,created_at
      FROM sync_attachments WHERE account_id=? ORDER BY created_at DESC,attachment_id DESC`).bind(accountId).all<Metadata>();
    return (result.results ?? []).map(map);
  }
  async upload(principal: SyncPrincipal, input: { uploadId: string; taskId: string; fileName: string; mediaType: string; bytes: Uint8Array; sha256: string }): Promise<AttachmentRecord> {
    if (!input.bytes.byteLength || input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentRequestError("invalid_attachment", 413);
    const accountId = await this.account(principal); await this.limit(accountId);
    const prior = await this.db.prepare(`SELECT attachment_id,task_id,file_name,media_type,byte_size,sha256,created_at,object_key
      FROM sync_attachments WHERE account_id=? AND client_upload_id=?`).bind(accountId, input.uploadId).first<Metadata>();
    if (prior) {
      if (prior.sha256 !== input.sha256 || prior.task_id !== input.taskId) throw new AttachmentRequestError("idempotency_key_reused", 409);
      return map(prior);
    }
    const task = await this.db.prepare(`SELECT entity_id FROM sync_entities WHERE account_id=? AND entity_type='tasks' AND entity_id=? AND deleted_at IS NULL`)
      .bind(accountId, input.taskId).first<{ entity_id: string }>();
    if (!task) throw new AttachmentRequestError("task_not_found", 404);
    const id = crypto.randomUUID(); const objectKey = `${accountId}/${id}`;
    await this.bucket.put(objectKey, asBuffer(input.bytes), { httpMetadata: { contentType: input.mediaType }, customMetadata: { accountId, attachmentId: id, sha256: input.sha256 } });
    try {
      await this.db.prepare(`INSERT INTO sync_attachments(account_id,attachment_id,task_id,client_upload_id,object_key,file_name,media_type,byte_size,sha256)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(accountId, id, input.taskId, input.uploadId, objectKey, input.fileName,
        input.mediaType, input.bytes.byteLength, input.sha256).run();
      return { id, taskId: input.taskId, fileName: input.fileName, mediaType: input.mediaType, size: input.bytes.byteLength,
        sha256: input.sha256, createdAt: new Date().toISOString() };
    } catch (error) {
      try { await this.bucket.delete(objectKey); }
      catch { await this.db.prepare("INSERT OR IGNORE INTO attachment_cleanup_outbox(object_key,account_id) VALUES(?,?)").bind(objectKey, accountId).run(); }
      throw error;
    }
  }
  async download(principal: SyncPrincipal, id: string): Promise<{ metadata: AttachmentRecord; body: ReadableStream<Uint8Array> } | undefined> {
    const accountId = await this.account(principal); await this.limit(accountId);
    const row = await this.db.prepare(`SELECT attachment_id,task_id,file_name,media_type,byte_size,sha256,created_at,object_key
      FROM sync_attachments WHERE account_id=? AND attachment_id=?`).bind(accountId, id).first<Metadata>();
    if (!row) return;
    const object = await this.bucket.get(row.object_key);
    if (!object) throw new Error("Attachment object is missing");
    return { metadata: map(row), body: object.body };
  }
  async remove(principal: SyncPrincipal, id: string): Promise<boolean> {
    const accountId = await this.account(principal); await this.limit(accountId);
    const row = await this.db.prepare("SELECT object_key FROM sync_attachments WHERE account_id=? AND attachment_id=?")
      .bind(accountId, id).first<{ object_key: string }>();
    if (!row) return false;
    await this.db.batch([
      this.db.prepare("INSERT OR IGNORE INTO attachment_cleanup_outbox(object_key,account_id) VALUES(?,?)").bind(row.object_key, accountId),
      this.db.prepare("DELETE FROM sync_attachments WHERE account_id=? AND attachment_id=?").bind(accountId, id)
    ]);
    try { await this.processCleanup(10); } catch { /* retained in the durable retry outbox */ }
    return true;
  }
  async processCleanup(limit = 50): Promise<{ removed: number; deferred: number }> {
    const entries = await this.db.prepare("SELECT object_key FROM attachment_cleanup_outbox ORDER BY created_at,object_key LIMIT ?")
      .bind(Math.max(1, Math.min(100, Math.trunc(limit)))).all<{ object_key: string }>();
    let removed = 0; let deferred = 0;
    for (const item of entries.results ?? []) {
      try {
        await this.bucket.delete(item.object_key);
        await this.db.prepare("DELETE FROM attachment_cleanup_outbox WHERE object_key=?").bind(item.object_key).run();
        removed += 1;
      } catch {
        await this.db.prepare("UPDATE attachment_cleanup_outbox SET attempts=attempts+1 WHERE object_key=?").bind(item.object_key).run();
        deferred += 1;
      }
    }
    return { removed, deferred };
  }

  /** Drains account prefixes only after the account's D1 rows have been deleted. */
  async processAccountDeletionJobs(limit = 2): Promise<{ pages: number; removed: number; completed: number }> {
    const jobs = await this.db.prepare(`SELECT account_id,r2_cursor FROM account_deletion_jobs ORDER BY created_at,account_id LIMIT ?`)
      .bind(Math.max(1, Math.min(10, Math.trunc(limit)))).all<{ account_id: string; r2_cursor: string | null }>();
    let pages = 0; let removed = 0; let completed = 0;
    for (const job of jobs.results ?? []) {
      const prefix = `${job.account_id}/`;
      const page = await this.bucket.list({ limit: 500, prefix, ...(job.r2_cursor ? { cursor: job.r2_cursor } : {}) });
      if (!Array.isArray(page.objects) || page.truncated && !page.cursor) throw new Error("R2 account-deletion page is invalid");
      for (const object of page.objects) {
        if (!object.key.startsWith(prefix)) throw new Error("R2 account-deletion prefix mismatch");
        await this.bucket.delete(object.key);
        removed += 1;
      }
      pages += 1;
      if (page.truncated && page.cursor) {
        await this.db.prepare("UPDATE account_deletion_jobs SET r2_cursor=? WHERE account_id=?")
          .bind(page.cursor, job.account_id).run();
      } else {
        await this.db.prepare("DELETE FROM account_deletion_jobs WHERE account_id=?").bind(job.account_id).run();
        completed += 1;
      }
    }
    return { pages, removed, completed };
  }

  /** Deletes old R2 objects only after D1 confirms that neither metadata nor the cleanup outbox references them. */
  async reconcileOrphans(limit = 100, now = Date.now()): Promise<{ inspected: number; removed: number; next: boolean }> {
    const state = await this.db.prepare("SELECT cursor FROM attachment_reconcile_state WHERE state_key='r2-orphan-scan'")
      .first<{ cursor: string | null }>();
    const page = await this.bucket.list({ limit: Math.max(1, Math.min(1000, Math.trunc(limit))), ...(state?.cursor ? { cursor: state.cursor } : {}) });
    if (!Array.isArray(page.objects) || page.truncated && !page.cursor) throw new Error("R2 reconciliation page is invalid");
    let removed = 0;
    const cutoff = now - 24 * 60 * 60 * 1000;
    for (const object of page.objects) {
      if (!(object.uploaded instanceof Date) || object.uploaded.getTime() > cutoff) continue;
      const referenced = await this.db.prepare(`SELECT 1 AS found FROM sync_attachments WHERE object_key=?
        UNION ALL SELECT 1 AS found FROM attachment_cleanup_outbox WHERE object_key=? LIMIT 1`)
        .bind(object.key, object.key).first<{ found: number }>();
      if (referenced) continue;
      await this.bucket.delete(object.key);
      removed += 1;
    }
    if (page.truncated && page.cursor) {
      await this.db.prepare(`INSERT INTO attachment_reconcile_state(state_key,cursor,updated_at) VALUES('r2-orphan-scan',?,?)
        ON CONFLICT(state_key) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at`)
        .bind(page.cursor, new Date(now).toISOString()).run();
    } else {
      await this.db.prepare("DELETE FROM attachment_reconcile_state WHERE state_key='r2-orphan-scan'").run();
    }
    return { inspected: page.objects.length, removed, next: page.truncated };
  }
  private async account(principal: SyncPrincipal): Promise<string> {
    await this.db.prepare(`INSERT INTO sync_accounts(account_id,issuer,subject) VALUES(?,?,?)
      ON CONFLICT(issuer,subject) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
      .bind(crypto.randomUUID(), principal.issuer, principal.subject).run();
    const row = await this.db.prepare("SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?")
      .bind(principal.issuer, principal.subject).first<{ account_id: string }>();
    if (!row) throw new Error("Account lookup failed");
    return row.account_id;
  }
  private async limit(accountId: string) {
    const window = new Date().toISOString().slice(0, 16);
    const row = await this.db.prepare(`INSERT INTO sync_rate_limits(account_id,window_start,request_count) VALUES(?,?,1)
      ON CONFLICT(account_id) DO UPDATE SET request_count=CASE WHEN window_start=excluded.window_start THEN request_count+1 ELSE 1 END,
      window_start=excluded.window_start RETURNING request_count`).bind(accountId, window).first<{ request_count: number }>();
    if ((row?.request_count ?? this.requestsPerMinute + 1) > this.requestsPerMinute) throw new SyncRateLimitError();
  }
}
