-- Preserve all current records and tombstones while extending the accepted entity types.
CREATE TABLE sync_entities_with_preferences (
  account_id TEXT NOT NULL REFERENCES sync_accounts(account_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('tasks','projects','sections','tags','blocks','calendars','calendarEvents','taskTemplates','eventTemplates','routines','reminders','completions','savedViews','preferences')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  client_schema_version INTEGER NOT NULL CHECK (client_schema_version = 4),
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  updated_sequence INTEGER NOT NULL DEFAULT 0 CHECK (updated_sequence >= 0),
  PRIMARY KEY (account_id, entity_type, entity_id),
  CHECK ((deleted_at IS NULL AND json_type(payload) = 'object') OR (deleted_at IS NOT NULL AND payload IS NULL))
);
INSERT INTO sync_entities_with_preferences SELECT account_id,entity_type,entity_id,revision,client_schema_version,payload,deleted_at,updated_at,updated_sequence FROM sync_entities;
DROP TABLE sync_entities;
ALTER TABLE sync_entities_with_preferences RENAME TO sync_entities;
