CREATE TABLE IF NOT EXISTS sync_accounts (
  account_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  change_sequence INTEGER NOT NULL DEFAULT 0 CHECK (change_sequence >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS sync_devices (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  client_kind TEXT NOT NULL CHECK (client_kind IN ('web', 'apple')),
  acknowledged_sequence INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged_sequence >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  retired_at TEXT,
  PRIMARY KEY (account_id, device_id)
);

CREATE TABLE IF NOT EXISTS sync_entities (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('tasks','projects','sections','tags','blocks','calendars','calendarEvents','taskTemplates','eventTemplates','routines','reminders','completions','savedViews')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  client_schema_version INTEGER NOT NULL CHECK (client_schema_version = 4),
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, entity_type, entity_id),
  CHECK ((deleted_at IS NULL AND json_type(payload) = 'object') OR (deleted_at IS NOT NULL AND payload IS NULL))
);

CREATE TABLE IF NOT EXISTS sync_journal (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  client_schema_version INTEGER NOT NULL CHECK (client_schema_version = 4),
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, sequence),
  CHECK ((deleted_at IS NULL AND json_type(payload) = 'object') OR (deleted_at IS NOT NULL AND payload IS NULL))
);
CREATE INDEX IF NOT EXISTS sync_journal_entity_idx ON sync_journal(account_id, entity_type, entity_id, sequence DESC);

CREATE TABLE IF NOT EXISTS sync_idempotency (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  client_mutation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  response TEXT NOT NULL CHECK (json_valid(response) AND json_type(response) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (account_id, client_mutation_id)
);

CREATE TABLE IF NOT EXISTS sync_rate_limits (
  account_id TEXT PRIMARY KEY REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0)
);
