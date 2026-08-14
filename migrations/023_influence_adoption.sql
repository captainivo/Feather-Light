-- Bind explicit adoption to the exact reviewed payload without storing that payload.
ALTER TABLE influence_decisions ADD COLUMN payload_hash TEXT;
ALTER TABLE influence_decisions ADD COLUMN adopts_request_id TEXT REFERENCES influence_decisions(request_id);

CREATE INDEX idx_influence_decisions_adoption
  ON influence_decisions(adopts_request_id)
  WHERE adopts_request_id IS NOT NULL;
