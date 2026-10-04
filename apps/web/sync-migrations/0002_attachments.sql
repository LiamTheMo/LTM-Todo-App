CREATE TABLE IF NOT EXISTS sync_attachments (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  client_upload_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (account_id, attachment_id),
  UNIQUE (account_id, client_upload_id)
);
CREATE INDEX IF NOT EXISTS sync_attachments_task_idx ON sync_attachments(account_id, task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachment_cleanup_outbox (
  object_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
