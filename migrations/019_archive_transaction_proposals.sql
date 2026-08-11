CREATE TABLE archive_transaction_proposals (
  transaction_id TEXT PRIMARY KEY REFERENCES archive_transactions(transaction_id) ON DELETE CASCADE,
  proposal_hash TEXT NOT NULL UNIQUE,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  prepared_by TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  CHECK ((approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE INDEX archive_transaction_proposals_approval
  ON archive_transaction_proposals(approved_at, prepared_at);
