CREATE TABLE chronology_periods (
    period_id TEXT PRIMARY KEY,
    timeline_source_file_id TEXT NOT NULL REFERENCES source_files(source_file_id) ON DELETE CASCADE,
    source_section_id TEXT NOT NULL REFERENCES source_sections(section_id) ON DELETE CASCADE,
    source_line INTEGER NOT NULL,
    period_order INTEGER NOT NULL,
    label TEXT NOT NULL,
    civilizational_status TEXT NOT NULL,
    summary TEXT NOT NULL,
    canon_status TEXT,
    UNIQUE (timeline_source_file_id, period_order)
);

CREATE TABLE chronology_events (
    event_id TEXT PRIMARY KEY,
    event_key TEXT NOT NULL,
    label TEXT NOT NULL,
    timeline_source_file_id TEXT NOT NULL REFERENCES source_files(source_file_id) ON DELETE CASCADE,
    source_section_id TEXT NOT NULL REFERENCES source_sections(section_id) ON DELETE CASCADE,
    source_line INTEGER NOT NULL,
    event_sequence INTEGER NOT NULL,
    sequence_is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (sequence_is_canonical = 0),
    old_clock_year INTEGER,
    date_status TEXT NOT NULL CHECK (date_status IN ('unknown', 'explicit')),
    date_display TEXT NOT NULL,
    timeline_anchor TEXT,
    observer_time TEXT NOT NULL DEFAULT 'unknown' CHECK (observer_time IN (
        'past', 'contemporary_reachable', 'contemporary_unreachable', 'future', 'unknown'
    )),
    canon_status TEXT,
    UNIQUE (timeline_source_file_id, source_line)
);

CREATE INDEX chronology_events_sequence ON chronology_events(event_sequence, event_id);
CREATE INDEX chronology_events_key ON chronology_events(event_key);
CREATE INDEX chronology_events_anchor ON chronology_events(timeline_anchor, event_sequence);

