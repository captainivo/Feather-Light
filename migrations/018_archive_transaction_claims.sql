ALTER TABLE archive_transactions ADD COLUMN claimed_by TEXT;
ALTER TABLE archive_transactions ADD COLUMN processing_started_at TEXT;

CREATE INDEX archive_transactions_pending_claim
  ON archive_transactions(status, received_at, transaction_id);
