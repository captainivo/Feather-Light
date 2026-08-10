CREATE TABLE dream_seeds (
  dream_id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('unread','held','released')),
  source_material_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  held_at TEXT,
  released_at TEXT,
  release_note TEXT
);

CREATE INDEX idx_dreams_unread_created
  ON dream_seeds(status, created_at DESC);
