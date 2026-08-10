ALTER TABLE archive_note_events ADD COLUMN event_hash TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX archive_note_events_transaction ON archive_note_events(transaction_id, occurred_at, event_id);
