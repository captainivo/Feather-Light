CREATE TABLE definitions (
    definition_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    definition_text TEXT NOT NULL,
    definition_kind TEXT NOT NULL CHECK (definition_kind IN ('source_explicit', 'source_derived')),
    source_section_id TEXT REFERENCES source_sections(section_id) ON DELETE SET NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    is_preferred INTEGER NOT NULL DEFAULT 0,
    review_status TEXT NOT NULL CHECK (review_status IN ('accepted', 'needs_review')),
    extraction_rule TEXT NOT NULL,
    UNIQUE (entity_id, source_section_id, extraction_rule)
);

CREATE TABLE relationships (
    relationship_id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (relation_type = 'source_links_to'),
    target_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    source_section_id TEXT NOT NULL REFERENCES source_sections(section_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    UNIQUE (source_entity_id, target_entity_id, source_section_id)
);

CREATE TABLE unresolved_entity_links (
    unresolved_link_id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    source_section_id TEXT NOT NULL REFERENCES source_sections(section_id) ON DELETE CASCADE,
    target_text TEXT NOT NULL,
    normalized_target TEXT NOT NULL,
    resolution_status TEXT NOT NULL CHECK (resolution_status IN ('unresolved', 'ambiguous')),
    candidate_entity_ids_json TEXT NOT NULL,
    UNIQUE (source_entity_id, source_section_id, normalized_target)
);

CREATE INDEX definitions_entity_preferred ON definitions(entity_id, is_preferred DESC);
CREATE INDEX relationships_source ON relationships(source_entity_id, relation_type);
CREATE INDEX relationships_target ON relationships(target_entity_id, relation_type);
CREATE INDEX unresolved_entity_links_status ON unresolved_entity_links(resolution_status, normalized_target);

