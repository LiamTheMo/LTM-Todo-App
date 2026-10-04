CREATE TABLE IF NOT EXISTS sync_retention_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL
);
