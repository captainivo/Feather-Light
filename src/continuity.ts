import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import type { Config } from "./config.js";
import { SCHEMA_VERSION, type FeatherDatabase } from "./database.js";

export const CONTINUITY_MANIFEST_VERSION = 1;
export const FEATHER_LIGHT_VERSION = "0.4.0";

export type ContinuityHealth = "ready" | "degraded" | "error";
type IssueSeverity = "warning" | "error";

export interface ContinuityIssue {
  severity: IssueSeverity;
  code: string;
  component: string;
  message: string;
}

export interface ContinuityManifest {
  format: "feather-light/continuity-manifest";
  version: number;
  generatedAt: string;
  readOnly: true;
  health: ContinuityHealth;
  manifestHash: string;
  components: {
    service: Record<string, unknown>;
    identity: Record<string, unknown>;
    migrations: Record<string, unknown>;
    archive: Record<string, unknown>;
    environment: Record<string, unknown>;
    writableStores: Record<string, unknown>;
  };
  issues: ContinuityIssue[];
}

type SqlRow = Record<string, string | number | null>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function buildIdentity(config: Config, issues: ContinuityIssue[]): Record<string, unknown> {
  const configured = config.continuity?.identityArtifacts ?? [];
  if (configured.length === 0) {
    issues.push({
      severity: "warning",
      code: "identity_artifacts_unconfigured",
      component: "identity",
      message: "No identity artifacts are configured for continuity verification.",
    });
    return { status: "unconfigured", artifacts: [] };
  }

  const artifacts = configured.map((artifact) => {
    try {
      const stat = lstatSync(artifact.path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("artifact is not a regular file");
      if (stat.size > artifact.maxBytes) throw new Error(`artifact exceeds configured maxBytes (${artifact.maxBytes})`);
      const content = readFileSync(artifact.path);
      return {
        id: artifact.id,
        required: artifact.required,
        immutable: artifact.immutable,
        status: "verified",
        bytes: stat.size,
        sha256: sha256(content),
      };
    } catch {
      const severity: IssueSeverity = artifact.required ? "error" : "warning";
      issues.push({
        severity,
        code: artifact.required ? "required_identity_artifact_unavailable" : "optional_identity_artifact_unavailable",
        component: `identity:${artifact.id}`,
        message: "Identity artifact is unavailable, is not a regular file, or exceeds its configured size limit.",
      });
      return {
        id: artifact.id,
        required: artifact.required,
        immutable: artifact.immutable,
        status: "unavailable",
      };
    }
  });
  const requiredUnavailable = artifacts.some((artifact) => artifact.required && artifact.status !== "verified");
  const anyUnavailable = artifacts.some((artifact) => artifact.status !== "verified");
  return { status: requiredUnavailable ? "error" : anyUnavailable ? "degraded" : "verified", artifacts };
}

function buildMigrations(database: FeatherDatabase, issues: ContinuityIssue[]): Record<string, unknown> {
  const rows = database.prepare(
    "SELECT version, applied_at AS appliedAt, checksum FROM schema_migrations ORDER BY version",
  ).all() as Array<{ version: number; appliedAt: string; checksum: string | null }>;
  const appliedVersion = rows.at(-1)?.version ?? 0;
  const checksummed = rows.filter((row) => typeof row.checksum === "string" && row.checksum.length === 64);
  const complete = rows.length === SCHEMA_VERSION && appliedVersion === SCHEMA_VERSION && checksummed.length === rows.length;
  if (!complete) {
    issues.push({
      severity: "error",
      code: "migration_ledger_incomplete",
      component: "migrations",
      message: `Expected ${SCHEMA_VERSION} checksummed migrations; found ${checksummed.length} with applied version ${appliedVersion}.`,
    });
  }
  const ledger = rows.map((row) => ({ version: row.version, checksum: row.checksum }));
  return {
    status: complete ? "verified" : "error",
    supportedVersion: SCHEMA_VERSION,
    appliedVersion,
    appliedCount: rows.length,
    lastAppliedAt: rows.at(-1)?.appliedAt ?? null,
    ledgerHash: sha256(stableJson(ledger)),
  };
}

function buildArchive(database: FeatherDatabase, config: Config, issues: ContinuityIssue[]): Record<string, unknown> {
  if (config.archiveRoots.length === 0) {
    issues.push({
      severity: "warning",
      code: "archive_roots_unconfigured",
      component: "archive",
      message: "No archive roots are configured.",
    });
    return { status: "unconfigured", roots: [] };
  }
  const indexedRows = database.prepare(`
    SELECT root_id AS rootId, read_only AS readOnly, enabled,
      last_complete_ingest_id AS lastCompleteIngestId,
      last_attempted_ingest_id AS lastAttemptedIngestId
    FROM archive_roots
  `).all() as Array<{
    rootId: string;
    readOnly: number;
    enabled: number;
    lastCompleteIngestId: string | null;
    lastAttemptedIngestId: string | null;
  }>;
  const indexed = new Map(indexedRows.map((row) => [row.rootId, row]));
  let degraded = false;
  const roots = config.archiveRoots.map((root) => {
    const record = indexed.get(root.rootId);
    if (!record) {
      degraded = true;
      issues.push({
        severity: "warning",
        code: "archive_root_not_indexed",
        component: `archive:${root.rootId}`,
        message: "Configured archive root has no index record.",
      });
      return {
        id: root.rootId,
        enabled: root.enabled,
        readOnly: root.readOnly,
        status: "not_indexed",
        fileCount: 0,
        indexHash: null,
        lastCompleteIngestId: null,
        lastAttemptedIngestId: null,
      };
    }
    const files = database.prepare(`
      SELECT relative_path AS relativePath, content_hash AS contentHash
      FROM source_files WHERE root_id=? AND deleted=0 ORDER BY relative_path
    `).all(root.rootId) as Array<{ relativePath: string; contentHash: string }>;
    if (root.enabled && !record.lastCompleteIngestId) {
      degraded = true;
      issues.push({
        severity: "warning",
        code: "archive_root_never_completed",
        component: `archive:${root.rootId}`,
        message: "Enabled archive root has no completed ingest.",
      });
    }
    return {
      id: root.rootId,
      enabled: root.enabled,
      readOnly: root.readOnly && record.readOnly === 1,
      status: record.lastCompleteIngestId ? "indexed" : "incomplete",
      fileCount: files.length,
      indexHash: sha256(stableJson(files)),
      lastCompleteIngestId: record.lastCompleteIngestId,
      lastAttemptedIngestId: record.lastAttemptedIngestId,
    };
  });
  return { status: degraded ? "degraded" : "verified", roots };
}

function buildEnvironment(database: FeatherDatabase, issues: ContinuityIssue[]): Record<string, unknown> {
  const row = database.prepare(`
    SELECT absolute_day AS absoluteDay, earth_date AS earthDate, generated_at AS generatedAt,
      generator_version AS generatorVersion, seed_fingerprint AS seedFingerprint,
      source, state_json AS stateJson
    FROM environment_days ORDER BY absolute_day DESC LIMIT 1
  `).get() as (SqlRow & { stateJson: string }) | undefined;
  if (!row) {
    issues.push({
      severity: "warning",
      code: "environment_uninitialized",
      component: "environment",
      message: "No environment snapshot is available.",
    });
    return { status: "uninitialized", current: null };
  }
  return {
    status: "verified",
    current: {
      absoluteDay: row.absoluteDay,
      earthDate: row.earthDate,
      generatedAt: row.generatedAt,
      generatorVersion: row.generatorVersion,
      seedFingerprint: row.seedFingerprint,
      source: row.source,
      stateHash: sha256(row.stateJson),
    },
  };
}

function count(database: FeatherDatabase, table: string, condition = "1=1"): number {
  const allowed = new Set([
    "agency_directives", "growth_entries", "longing_entries", "dream_seeds",
    "memory_provenance", "influence_policies", "influence_decisions",
  ]);
  if (!allowed.has(table)) throw new Error(`unsupported continuity store: ${table}`);
  return Number((database.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${condition}`).get() as { count: number }).count);
}

function buildWritableStores(database: FeatherDatabase): Record<string, unknown> {
  const policies = database.prepare(`
    SELECT policy_id, policy_version, source_class, domain, authority, rationale
    FROM influence_policies ORDER BY policy_id
  `).all();
  const stores = {
    agency: {
      status: "available",
      total: count(database, "agency_directives"),
      active: count(database, "agency_directives", "status='active'"),
      revision: Number((database.prepare("SELECT COALESCE(MAX(revision),0) AS value FROM agency_directives").get() as { value: number }).value),
    },
    growth: {
      status: "available",
      total: count(database, "growth_entries"),
      active: count(database, "growth_entries", "status='active'"),
      latestUpdatedAt: (database.prepare("SELECT MAX(updated_at) AS value FROM growth_entries").get() as { value: string | null }).value,
    },
    longing: {
      status: "available",
      total: count(database, "longing_entries"),
      held: count(database, "longing_entries", "status='held'"),
      private: count(database, "longing_entries", "visibility='private'"),
      latestUpdatedAt: (database.prepare("SELECT MAX(updated_at) AS value FROM longing_entries").get() as { value: string | null }).value,
    },
    dreams: {
      status: "available",
      total: count(database, "dream_seeds"),
      unread: count(database, "dream_seeds", "status='unread'"),
      latestCreatedAt: (database.prepare("SELECT MAX(created_at) AS value FROM dream_seeds").get() as { value: string | null }).value,
    },
    memoryProvenance: {
      status: "available",
      total: count(database, "memory_provenance"),
      suppressed: count(database, "memory_provenance", "suppress_flag=1"),
      latestUpdatedAt: (database.prepare("SELECT MAX(updated_at) AS value FROM memory_provenance").get() as { value: string | null }).value,
    },
    influenceGate: {
      status: "available",
      policyVersion: Number((database.prepare("SELECT COALESCE(MAX(policy_version),0) AS value FROM influence_policies").get() as { value: number }).value),
      policyCount: count(database, "influence_policies"),
      policyHash: sha256(stableJson(policies)),
      decisions: count(database, "influence_decisions"),
      allowed: count(database, "influence_decisions", "decision='allow'"),
      review: count(database, "influence_decisions", "decision='review'"),
      denied: count(database, "influence_decisions", "decision='deny'"),
      latestEvaluatedAt: (database.prepare("SELECT MAX(evaluated_at) AS value FROM influence_decisions").get() as { value: string | null }).value,
    },
  };
  return { status: "verified", stores };
}

export function buildContinuityManifest(
  database: FeatherDatabase,
  config: Config,
  generatedAt = new Date().toISOString(),
): ContinuityManifest {
  const issues: ContinuityIssue[] = [];
  const components = {
    service: {
      status: "verified",
      name: "feather-light",
      version: FEATHER_LIGHT_VERSION,
      schemaVersion: SCHEMA_VERSION,
    },
    identity: buildIdentity(config, issues),
    migrations: buildMigrations(database, issues),
    archive: buildArchive(database, config, issues),
    environment: buildEnvironment(database, issues),
    writableStores: buildWritableStores(database),
  };
  const health: ContinuityHealth = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0 ? "degraded" : "ready";
  const hashPayload = {
    format: "feather-light/continuity-manifest",
    version: CONTINUITY_MANIFEST_VERSION,
    readOnly: true,
    health,
    components,
    issues,
  };
  return {
    format: "feather-light/continuity-manifest",
    version: CONTINUITY_MANIFEST_VERSION,
    generatedAt,
    readOnly: true,
    health,
    manifestHash: sha256(stableJson(hashPayload)),
    components,
    issues,
  };
}
