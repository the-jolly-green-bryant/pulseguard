ALTER TABLE monitors ADD COLUMN monitor_type TEXT NOT NULL DEFAULT 'inbox' CHECK (monitor_type IN ('gmail', 'inbox'));
ALTER TABLE monitors ADD COLUMN owner_email TEXT;
ALTER TABLE monitors ADD COLUMN sender_filter TEXT;
ALTER TABLE monitors ADD COLUMN subject_filter TEXT;

CREATE TABLE IF NOT EXISTS google_connections (
  email TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monitors_owner_type
ON monitors (owner_email, monitor_type, enabled);
