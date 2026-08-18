PRAGMA foreign_keys = ON;

CREATE TABLE petitions (
  uuid TEXT PRIMARY KEY,
  source_url TEXT NOT NULL UNIQUE,
  reference_number TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  public_status TEXT,
  internal_status TEXT,
  signed_count INTEGER NOT NULL DEFAULT 0,
  withdrawn_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  share_count INTEGER NOT NULL DEFAULT 0,
  threshold_level INTEGER NOT NULL DEFAULT 0,
  thresholds_json TEXT NOT NULL DEFAULT '[]',
  categories_json TEXT NOT NULL DEFAULT '[]',
  created_at_source TEXT,
  published_at TEXT,
  expires_at TEXT,
  is_signature_accepted INTEGER NOT NULL DEFAULT 0,
  is_closed INTEGER NOT NULL DEFAULT 0,
  is_expired INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TEXT NOT NULL,
  last_changed_at TEXT NOT NULL
);

CREATE TABLE tracked_sources (
  source_url TEXT PRIMARY KEY,
  petition_uuid TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (petition_uuid) REFERENCES petitions(uuid) ON DELETE SET NULL
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  petition_uuid TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  signed_count INTEGER NOT NULL,
  withdrawn_count INTEGER NOT NULL,
  view_count INTEGER NOT NULL,
  share_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  threshold_level INTEGER NOT NULL,
  FOREIGN KEY (petition_uuid) REFERENCES petitions(uuid) ON DELETE CASCADE,
  UNIQUE (petition_uuid, captured_at)
);

CREATE INDEX snapshots_petition_time
  ON snapshots (petition_uuid, captured_at);

CREATE TABLE status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  petition_uuid TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  field TEXT NOT NULL,
  previous_value TEXT,
  current_value TEXT,
  FOREIGN KEY (petition_uuid) REFERENCES petitions(uuid) ON DELETE CASCADE
);

CREATE INDEX status_events_petition_time
  ON status_events (petition_uuid, recorded_at DESC);
