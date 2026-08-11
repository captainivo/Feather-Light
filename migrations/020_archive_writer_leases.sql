ALTER TABLE archive_transaction_proposals ADD COLUMN writer_claimed_by TEXT;
ALTER TABLE archive_transaction_proposals ADD COLUMN writer_claimed_at TEXT;
ALTER TABLE archive_transaction_proposals ADD COLUMN writer_lease_until TEXT;

CREATE INDEX archive_transaction_proposals_writer_queue
  ON archive_transaction_proposals(approved_at, writer_lease_until, prepared_at);
