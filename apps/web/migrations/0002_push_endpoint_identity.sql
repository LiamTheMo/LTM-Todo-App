ALTER TABLE push_devices ADD COLUMN endpoint_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS push_devices_endpoint_hash ON push_devices(endpoint_hash);
