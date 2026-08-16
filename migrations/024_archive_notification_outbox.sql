CREATE TABLE archive_notification_outbox (
  notification_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES archive_transactions(transaction_id),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at TEXT,
  lease_until TEXT,
  sent_at TEXT,
  CHECK (sent_at IS NULL OR claimed_by IS NOT NULL)
);

CREATE INDEX archive_notification_outbox_pending
  ON archive_notification_outbox(sent_at, lease_until, created_at);
