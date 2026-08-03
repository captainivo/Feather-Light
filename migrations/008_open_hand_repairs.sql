PRAGMA foreign_keys = ON;

CREATE TABLE open_hand_repairs (
  repair_id TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN (
    'correct_objective_error', 'append_context', 'change_interpretation',
    'supersede', 'retract', 'suppress_retrieval', 'delete'
  )),
  storage_system TEXT NOT NULL,
  selector_type TEXT NOT NULL,
  selector_value TEXT NOT NULL,
  correction_text TEXT,
  note TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  capability_mode TEXT NOT NULL CHECK (capability_mode IN (
    'native', 'existing_control', 'external_adapter', 'manual', 'unsupported', 'unknown'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'applied', 'external_required', 'retracted', 'rejected'
  )),
  applied_at TEXT,
  retracted_at TEXT,
  result_json TEXT
);

CREATE TABLE retrieval_suppressions (
  suppression_id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL UNIQUE REFERENCES open_hand_repairs(repair_id),
  selector_type TEXT NOT NULL CHECK (selector_type IN (
    'source_file_id', 'relative_path', 'section_id', 'entity_id'
  )),
  selector_value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retracted')),
  created_at TEXT NOT NULL,
  retracted_at TEXT
);

CREATE INDEX open_hand_repairs_status_time ON open_hand_repairs(status, requested_at DESC);
CREATE INDEX open_hand_repairs_storage_selector ON open_hand_repairs(storage_system, selector_type, selector_value);
CREATE INDEX retrieval_suppressions_active_selector ON retrieval_suppressions(status, selector_type, selector_value);
