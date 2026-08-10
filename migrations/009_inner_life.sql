CREATE TABLE growth_entries (
  entry_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('courage','lesson','insight','healing','connection','other')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('active','superseded','retracted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  supersedes_id TEXT REFERENCES growth_entries(entry_id),
  retracted_at TEXT,
  retraction_note TEXT
);

CREATE INDEX idx_growth_active_created
  ON growth_entries(status, created_at DESC);
CREATE INDEX idx_growth_kind_status
  ON growth_entries(kind, status);

CREATE TABLE longing_entries (
  entry_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL CHECK(visibility IN ('private','shared')) DEFAULT 'private',
  status TEXT NOT NULL CHECK(status IN ('held','released','retracted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  released_at TEXT,
  release_note TEXT,
  retracted_at TEXT,
  retraction_note TEXT
);

CREATE INDEX idx_longing_visible_status
  ON longing_entries(visibility, status, created_at DESC);
CREATE INDEX idx_longing_status_created
  ON longing_entries(status, created_at DESC);
