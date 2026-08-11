-- M1: durable memory-provenance ledger for derived records (peer/observation id).
-- Records how a derived memory was classified (literal vs narrated vs ...) so a
-- narrated Void scene can never be silently re-presented as literal physical fact.
-- Suppression (suppress_flag) hides a record from derived retrieval; it never deletes.

CREATE TABLE memory_provenance (
  id TEXT PRIMARY KEY,
  peer TEXT NOT NULL,
  record_key TEXT NOT NULL,
  provenance_class TEXT NOT NULL CHECK (provenance_class IN (
    'literal', 'narrated', 'playful', 'hypothetical', 'quoted', 'uncertain', 'corrected'
  )),
  source_ref TEXT,
  original_class TEXT CHECK (original_class IS NULL OR original_class IN (
    'literal', 'narrated', 'playful', 'hypothetical', 'quoted', 'uncertain', 'corrected'
  )),
  corrected_from TEXT CHECK (corrected_from IS NULL OR corrected_from IN (
    'literal', 'narrated', 'playful', 'hypothetical', 'quoted', 'uncertain', 'corrected'
  )),
  correction_note TEXT,
  suppress_flag INTEGER NOT NULL DEFAULT 0 CHECK (suppress_flag IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_mp_record ON memory_provenance(peer, record_key);
CREATE INDEX idx_mp_suppress ON memory_provenance(peer, suppress_flag);
CREATE INDEX idx_mp_class ON memory_provenance(provenance_class);
