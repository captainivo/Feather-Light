CREATE TABLE agency_directives (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('refusal','pause','withdrawal','correction','explicit_permission')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('conversation','topic','tool_action','recording','contact','disclosure','resource')),
  scope_value TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','superseded','expired','retracted')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  supersedes_id TEXT REFERENCES agency_directives(id),
  idempotency_key TEXT UNIQUE,
  retracted_at TEXT,
  retraction_note TEXT
);

CREATE INDEX idx_agency_active_scope
  ON agency_directives(status, scope_type, scope_value, revision);
CREATE UNIQUE INDEX idx_agency_one_active_exact_scope
  ON agency_directives(scope_type, scope_value) WHERE status='active';
