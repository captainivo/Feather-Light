PRAGMA foreign_keys = ON;

CREATE TABLE archive_roots (
    root_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    absolute_path TEXT NOT NULL,
    read_only INTEGER NOT NULL CHECK (read_only = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    last_complete_ingest_id TEXT,
    last_attempted_ingest_id TEXT
);

CREATE TABLE ingest_runs (
    ingest_id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL REFERENCES archive_roots(root_id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
    files_seen INTEGER NOT NULL DEFAULT 0,
    files_opened INTEGER NOT NULL DEFAULT 0,
    bytes_read INTEGER NOT NULL DEFAULT 0,
    records_changed INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT,
    parser_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL
);

CREATE TABLE source_files (
    source_file_id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL REFERENCES archive_roots(root_id),
    relative_path TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mtime_ns TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    encoding TEXT NOT NULL,
    title TEXT NOT NULL,
    frontmatter_json TEXT NOT NULL,
    first_seen_ingest_id TEXT NOT NULL REFERENCES ingest_runs(ingest_id),
    last_seen_ingest_id TEXT NOT NULL REFERENCES ingest_runs(ingest_id),
    deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE (root_id, relative_path)
);

CREATE TABLE source_sections (
    section_id TEXT PRIMARY KEY,
    source_file_id TEXT NOT NULL REFERENCES source_files(source_file_id) ON DELETE CASCADE,
    heading_path TEXT NOT NULL,
    heading_level INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    section_hash TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    UNIQUE (source_file_id, ordinal)
);

CREATE TABLE wikilinks (
    wikilink_id TEXT PRIMARY KEY,
    source_section_id TEXT NOT NULL REFERENCES source_sections(section_id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    target_heading TEXT,
    display_text TEXT
);

CREATE VIRTUAL TABLE sections_fts USING fts5(
    section_id UNINDEXED,
    title,
    heading_path,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX source_files_root_path ON source_files(root_id, relative_path);
CREATE INDEX source_files_hash ON source_files(root_id, content_hash);
CREATE INDEX source_sections_file ON source_sections(source_file_id, ordinal);
CREATE INDEX wikilinks_target ON wikilinks(target);

