CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  inbox_address TEXT NOT NULL UNIQUE,
  schedule_hour_utc INTEGER NOT NULL CHECK (schedule_hour_utc BETWEEN 0 AND 23),
  grace_minutes INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes BETWEEN 0 AND 360),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  destination TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (monitor_id, channel, destination)
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  received_at TEXT NOT NULL,
  sender TEXT NOT NULL,
  message_id TEXT,
  UNIQUE (monitor_id, message_id)
);

CREATE TABLE IF NOT EXISTS alert_runs (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  alert_day TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (monitor_id, alert_day)
);

CREATE INDEX IF NOT EXISTS idx_recipients_monitor_enabled
ON recipients (monitor_id, enabled);

CREATE INDEX IF NOT EXISTS idx_receipts_monitor_received
ON receipts (monitor_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitors_enabled
ON monitors (enabled) WHERE enabled = 1;

PRAGMA optimize;
