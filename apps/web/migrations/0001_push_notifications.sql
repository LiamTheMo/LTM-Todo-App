CREATE TABLE IF NOT EXISTS push_devices (
  token_hash TEXT PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_registration_limits (
  ip_hash TEXT PRIMARY KEY,
  hour_start INTEGER NOT NULL,
  registrations INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_reminders (
  token_hash TEXT NOT NULL REFERENCES push_devices(token_hash) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL,
  title TEXT NOT NULL,
  trigger_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  locked_until INTEGER,
  PRIMARY KEY (token_hash, reminder_id)
);

CREATE INDEX IF NOT EXISTS push_reminders_due ON push_reminders(sent_at, trigger_at, locked_until);
