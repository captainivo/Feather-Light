CREATE TABLE entities (
    entity_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'Person', 'Place', 'Organization', 'Species', 'Culture',
        'Civilization', 'Artifact', 'Technology', 'Event', 'Concept'
    )),
    canonical_label TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    source_file_id TEXT NOT NULL UNIQUE REFERENCES source_files(source_file_id) ON DELETE CASCADE,
    source_type TEXT,
    canon_status TEXT,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    review_status TEXT NOT NULL CHECK (review_status IN ('accepted', 'needs_review')),
    classification_reason TEXT NOT NULL,
    retired INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE entity_aliases (
    alias_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    UNIQUE (entity_id, normalized_alias)
);

CREATE TABLE entity_duplicate_candidates (
    candidate_id TEXT PRIMARY KEY,
    left_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    right_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    match_kind TEXT NOT NULL CHECK (match_kind IN ('canonical_label', 'alias_collision')),
    score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
    reason TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'distinct', 'merge')),
    CHECK (left_entity_id < right_entity_id),
    UNIQUE (left_entity_id, right_entity_id, match_kind)
);

CREATE INDEX entities_type_label ON entities(entity_type, normalized_label);
CREATE INDEX entity_aliases_normalized ON entity_aliases(normalized_alias);
CREATE INDEX entity_duplicate_review ON entity_duplicate_candidates(review_status, score DESC);

