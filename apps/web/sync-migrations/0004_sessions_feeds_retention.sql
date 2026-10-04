ALTER TABLE sync_accounts ADD COLUMN min_available_sequence INTEGER NOT NULL DEFAULT 0 CHECK (min_available_sequence >= 0);
ALTER TABLE sync_entities ADD COLUMN updated_sequence INTEGER NOT NULL DEFAULT 0 CHECK (updated_sequence >= 0);

CREATE TABLE IF NOT EXISTS auth_sessions (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  session_id_hash TEXT NOT NULL CHECK (length(session_id_hash) = 64 AND session_id_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT,
  PRIMARY KEY (account_id, session_id_hash)
);
CREATE INDEX IF NOT EXISTS auth_sessions_active_idx ON auth_sessions(account_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS ics_subscriptions (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  encrypted_url TEXT NOT NULL CHECK (length(encrypted_url) BETWEEN 32 AND 8192),
  cache_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(cache_json) AND json_type(cache_json) = 'array'),
  etag TEXT,
  last_modified TEXT,
  last_attempt_at TEXT,
  last_refresh_at TEXT,
  next_refresh_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (account_id, subscription_id),
  UNIQUE (account_id, calendar_id)
);
CREATE INDEX IF NOT EXISTS ics_subscriptions_due_idx ON ics_subscriptions(next_refresh_at, account_id, subscription_id);

-- No FK by design: the account row is deleted before its R2 prefix is drained.
CREATE TABLE IF NOT EXISTS account_deletion_jobs (
  account_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  r2_cursor TEXT
);
