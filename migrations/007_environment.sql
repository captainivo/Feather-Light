CREATE TABLE environment_days (
  absolute_day INTEGER PRIMARY KEY,
  earth_date TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  seed_fingerprint TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('legacy_import','typescript')),
  state_json TEXT NOT NULL
);

CREATE TABLE environment_generation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  dates_processed_json TEXT NOT NULL DEFAULT '[]',
  days_generated INTEGER NOT NULL DEFAULT 0,
  success INTEGER,
  error_details TEXT
);
