CREATE TABLE archive_notes (
  note_id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_edited_at TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  content_hash TEXT NOT NULL,
  git_last_commit TEXT
);

CREATE TABLE archive_note_events (
  event_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES archive_notes(note_id),
  transaction_id TEXT NOT NULL REFERENCES archive_transactions(transaction_id),
  occurred_at TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('NEW', 'EXPAND', 'REVISE', 'RETCON', 'REORGANIZE', 'LINK')),
  title_at_time TEXT NOT NULL,
  words_before INTEGER NOT NULL CHECK (words_before >= 0),
  words_after INTEGER NOT NULL CHECK (words_after >= 0),
  words_added INTEGER NOT NULL CHECK (words_added >= 0),
  words_removed INTEGER NOT NULL CHECK (words_removed >= 0),
  net_words INTEGER NOT NULL,
  links_added INTEGER NOT NULL CHECK (links_added >= 0),
  links_removed INTEGER NOT NULL CHECK (links_removed >= 0),
  source_hash TEXT NOT NULL,
  git_commit TEXT,
  actor TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata))
);

CREATE TABLE archive_categories (
  category_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE archive_note_event_categories (
  event_id TEXT NOT NULL REFERENCES archive_note_events(event_id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES archive_categories(category_id),
  role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight > 0),
  PRIMARY KEY (event_id, category_id)
);

CREATE INDEX archive_note_events_occurred ON archive_note_events(occurred_at DESC);
CREATE INDEX archive_note_events_note ON archive_note_events(note_id, occurred_at DESC);
CREATE INDEX archive_note_event_categories_category ON archive_note_event_categories(category_id, event_id);
