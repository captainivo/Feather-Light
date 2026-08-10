CREATE TABLE archive_transactions (
  transaction_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  mode TEXT NOT NULL CHECK (mode IN (
    'capture', 'develop', 'archive', 'update', 'retcon', 'discard', 'lookup', 'report'
  )),
  source_client TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  requested_status TEXT NOT NULL CHECK (requested_status IN (
    'canon', 'probable', 'draft', 'speculative', 'contradicted', 'retconned', 'discarded'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'processing', 'succeeded', 'failed', 'partial'
  )),
  completed_at TEXT,
  summary TEXT,
  git_commit TEXT,
  error_summary TEXT
);

CREATE INDEX archive_transactions_status_received
  ON archive_transactions(status, received_at DESC);
CREATE INDEX archive_transactions_submitted
  ON archive_transactions(submitted_at DESC);
