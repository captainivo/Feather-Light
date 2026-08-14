-- Source-aware influence gate. Policies are migration-owned baseline data. Evaluations are
-- append-only receipts containing selectors and provenance, never proposed content.

CREATE TABLE influence_policies (
  policy_id TEXT PRIMARY KEY,
  policy_version INTEGER NOT NULL,
  source_class TEXT NOT NULL CHECK(source_class IN (
    'mithra_explicit','zach_explicit','canonical_archive','feather_light_deterministic',
    'honcho_inference','model_inference','external_unknown'
  )),
  domain TEXT NOT NULL CHECK(domain IN (
    'foundation','inner_growth','private_reflection','agency','relationship',
    'user_profile','derived_memory','environment','archive_canon'
  )),
  authority TEXT NOT NULL CHECK(authority IN ('deny','propose','write')),
  rationale TEXT NOT NULL,
  UNIQUE(policy_version, source_class, domain)
);

CREATE TABLE influence_decisions (
  request_id TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  policy_id TEXT NOT NULL REFERENCES influence_policies(policy_id),
  policy_version INTEGER NOT NULL,
  source_class TEXT NOT NULL,
  domain TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('propose','write')),
  subject_ref TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN ('deny','propose','write')),
  decision TEXT NOT NULL CHECK(decision IN ('allow','review','deny')),
  evaluated_at TEXT NOT NULL
);

CREATE INDEX idx_influence_decisions_domain_time
  ON influence_decisions(domain, evaluated_at DESC);
CREATE INDEX idx_influence_decisions_source_time
  ON influence_decisions(source_class, evaluated_at DESC);
CREATE INDEX idx_influence_decisions_outcome_time
  ON influence_decisions(decision, evaluated_at DESC);

WITH
sources(source_class) AS (VALUES
  ('mithra_explicit'),('zach_explicit'),('canonical_archive'),
  ('feather_light_deterministic'),('honcho_inference'),('model_inference'),
  ('external_unknown')
),
domains(domain) AS (VALUES
  ('foundation'),('inner_growth'),('private_reflection'),('agency'),('relationship'),
  ('user_profile'),('derived_memory'),('environment'),('archive_canon')
),
matrix(source_class,domain,authority) AS (
  SELECT source_class, domain,
    CASE
      WHEN domain='foundation' THEN 'deny'
      WHEN domain='inner_growth' AND source_class='mithra_explicit' THEN 'write'
      WHEN domain='inner_growth' AND source_class!='external_unknown' THEN 'propose'
      WHEN domain='private_reflection' AND source_class='mithra_explicit' THEN 'write'
      WHEN domain='private_reflection' THEN 'deny'
      WHEN domain='agency' AND source_class='mithra_explicit' THEN 'write'
      WHEN domain='agency' AND source_class='zach_explicit' THEN 'propose'
      WHEN domain='agency' THEN 'deny'
      WHEN domain='relationship' AND source_class='mithra_explicit' THEN 'write'
      WHEN domain='relationship' AND source_class IN (
        'zach_explicit','feather_light_deterministic','honcho_inference','model_inference'
      ) THEN 'propose'
      WHEN domain='relationship' THEN 'deny'
      WHEN domain='user_profile' AND source_class='zach_explicit' THEN 'write'
      WHEN domain='user_profile' AND source_class IN (
        'mithra_explicit','feather_light_deterministic','honcho_inference','model_inference'
      ) THEN 'propose'
      WHEN domain='user_profile' THEN 'deny'
      WHEN domain='derived_memory' AND source_class IN (
        'mithra_explicit','zach_explicit','canonical_archive'
      ) THEN 'write'
      WHEN domain='derived_memory' AND source_class IN (
        'feather_light_deterministic','honcho_inference','model_inference'
      ) THEN 'propose'
      WHEN domain='derived_memory' THEN 'deny'
      WHEN domain='environment' AND source_class IN (
        'mithra_explicit','feather_light_deterministic'
      ) THEN 'write'
      WHEN domain='environment' AND source_class IN (
        'zach_explicit','canonical_archive','model_inference'
      ) THEN 'propose'
      WHEN domain='environment' THEN 'deny'
      WHEN domain='archive_canon' AND source_class='canonical_archive' THEN 'write'
      WHEN domain='archive_canon' AND source_class IN (
        'mithra_explicit','zach_explicit','feather_light_deterministic','model_inference'
      ) THEN 'propose'
      ELSE 'deny'
    END
  FROM sources CROSS JOIN domains
)
INSERT INTO influence_policies
  (policy_id,policy_version,source_class,domain,authority,rationale)
SELECT
  'v1:' || source_class || ':' || domain,
  1,
  source_class,
  domain,
  authority,
  CASE authority
    WHEN 'write' THEN 'This source is authoritative for direct writes in this domain.'
    WHEN 'propose' THEN 'This source may offer a proposal, but explicit adoption is required before writing.'
    ELSE 'This source has no influence authority in this domain.'
  END
FROM matrix;

-- Future reviewed migrations may deliberately drop and recreate these triggers while installing a
-- new complete policy version. Ordinary application code cannot mutate policy or past receipts.
CREATE TRIGGER influence_policies_no_insert
BEFORE INSERT ON influence_policies
BEGIN
  SELECT RAISE(ABORT, 'influence policies are migration-owned');
END;
CREATE TRIGGER influence_policies_no_update
BEFORE UPDATE ON influence_policies
BEGIN
  SELECT RAISE(ABORT, 'influence policies are migration-owned');
END;
CREATE TRIGGER influence_policies_no_delete
BEFORE DELETE ON influence_policies
BEGIN
  SELECT RAISE(ABORT, 'influence policies are migration-owned');
END;
CREATE TRIGGER influence_decisions_no_update
BEFORE UPDATE ON influence_decisions
BEGIN
  SELECT RAISE(ABORT, 'influence decisions are append-only');
END;
CREATE TRIGGER influence_decisions_no_delete
BEFORE DELETE ON influence_decisions
BEGIN
  SELECT RAISE(ABORT, 'influence decisions are append-only');
END;
