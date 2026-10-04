CREATE TABLE IF NOT EXISTS attachment_reconcile_state (
  state_key TEXT PRIMARY KEY CHECK (state_key = 'r2-orphan-scan'),
  cursor TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
