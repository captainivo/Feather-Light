DROP INDEX relationships_source;
DROP INDEX relationships_target;
ALTER TABLE relationships RENAME TO relationships_v3;

CREATE TABLE relationships (
    relationship_id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (relation_type IN (
        'located_in', 'part_of', 'member_of', 'created_by', 'used_by',
        'preceded_by', 'followed_by', 'associated_with', 'source_links_to'
    )),
    target_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    source_section_id TEXT REFERENCES source_sections(section_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    extraction_rule TEXT NOT NULL,
    UNIQUE (source_entity_id, relation_type, target_entity_id, source_section_id, extraction_rule)
);

INSERT INTO relationships(
    relationship_id, source_entity_id, relation_type, target_entity_id,
    source_section_id, confidence, extraction_rule
)
SELECT relationship_id, source_entity_id, relation_type, target_entity_id,
    source_section_id, confidence, 'wikilink'
FROM relationships_v3;

DROP TABLE relationships_v3;
CREATE INDEX relationships_source ON relationships(source_entity_id, relation_type);
CREATE INDEX relationships_target ON relationships(target_entity_id, relation_type);

CREATE TABLE assertions (
    assertion_id TEXT PRIMARY KEY,
    subject_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    predicate TEXT NOT NULL,
    object_entity_id TEXT REFERENCES entities(entity_id) ON DELETE SET NULL,
    claim_text TEXT NOT NULL,
    source_section_id TEXT NOT NULL REFERENCES source_sections(section_id) ON DELETE CASCADE,
    canon_status TEXT,
    knowledge_status TEXT NOT NULL CHECK (knowledge_status IN (
        'known', 'unconfirmed', 'reported', 'speculation', 'contested', 'unknown'
    )),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    review_status TEXT NOT NULL CHECK (review_status IN ('accepted', 'needs_review')),
    extraction_rule TEXT NOT NULL
);

CREATE INDEX assertions_subject ON assertions(subject_entity_id, predicate);
CREATE INDEX assertions_source ON assertions(source_section_id);

