import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";

export const influenceSourceClasses = [
  "mithra_explicit",
  "zach_explicit",
  "canonical_archive",
  "feather_light_deterministic",
  "honcho_inference",
  "model_inference",
  "external_unknown",
] as const;

export const influenceDomains = [
  "foundation",
  "inner_growth",
  "private_reflection",
  "agency",
  "relationship",
  "user_profile",
  "derived_memory",
  "environment",
  "archive_canon",
] as const;

export const influenceOperations = ["propose", "write"] as const;
export const influenceAuthorities = ["deny", "propose", "write"] as const;
export const influenceDecisions = ["allow", "review", "deny"] as const;

export type InfluenceSourceClass = (typeof influenceSourceClasses)[number];
export type InfluenceDomain = (typeof influenceDomains)[number];
export type InfluenceOperation = (typeof influenceOperations)[number];
export type InfluenceAuthority = (typeof influenceAuthorities)[number];
export type InfluenceDecision = (typeof influenceDecisions)[number];

export const influenceContextSchema = z.object({
  request_id: z.string().trim().min(1).max(200),
  source_class: z.enum(influenceSourceClasses),
  source_ref: z.string().trim().min(1).max(500),
  adopts_request_id: z.string().trim().min(1).max(200).optional(),
}).strict();

export const influenceRequestSchema = influenceContextSchema.extend({
  domain: z.enum(influenceDomains),
  operation: z.enum(influenceOperations),
  subject_ref: z.string().trim().min(1).max(500),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export type InfluenceContext = z.infer<typeof influenceContextSchema>;
export type InfluenceRequest = z.infer<typeof influenceRequestSchema>;

export interface InfluenceResult extends InfluenceRequest {
  policy_id: string;
  policy_version: number;
  authority: InfluenceAuthority;
  decision: InfluenceDecision;
  rationale: string;
  evaluated_at: string;
  replayed: boolean;
}

interface PolicyRow {
  policy_id: string;
  policy_version: number;
  source_class: InfluenceSourceClass;
  domain: InfluenceDomain;
  authority: InfluenceAuthority;
  rationale: string;
}

interface DecisionRow {
  request_id: string;
  request_fingerprint: string;
  policy_id: string;
  policy_version: number;
  source_class: InfluenceSourceClass;
  domain: InfluenceDomain;
  operation: InfluenceOperation;
  subject_ref: string;
  source_ref: string;
  payload_hash: string | null;
  adopts_request_id: string | null;
  authority: InfluenceAuthority;
  decision: InfluenceDecision;
  evaluated_at: string;
}

function fingerprint(request: InfluenceRequest): string {
  return createHash("sha256").update(JSON.stringify({
    request_id: request.request_id,
    source_class: request.source_class,
    source_ref: request.source_ref,
    domain: request.domain,
    operation: request.operation,
    subject_ref: request.subject_ref,
    payload_hash: request.payload_hash ?? null,
    adopts_request_id: request.adopts_request_id ?? null,
  })).digest("hex");
}

function resultFromRows(request: InfluenceRequest, policy: PolicyRow, row: DecisionRow, replayed: boolean): InfluenceResult {
  return {
    ...request,
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    authority: row.authority,
    decision: row.decision,
    rationale: policy.rationale,
    evaluated_at: row.evaluated_at,
    replayed,
  };
}

function decisionFor(authority: InfluenceAuthority, operation: InfluenceOperation): InfluenceDecision {
  if (operation === "propose") return authority === "deny" ? "deny" : "allow";
  if (authority === "write") return "allow";
  return authority === "propose" ? "review" : "deny";
}

/**
 * Evaluate and durably receipt an influence request. Receipts contain selectors and provenance,
 * never the proposed content. Reusing a request ID is safe only for an identical request.
 */
export function evaluateInfluence(database: FeatherDatabase, value: InfluenceRequest): InfluenceResult {
  const request = influenceRequestSchema.parse(value);
  const requestFingerprint = fingerprint(request);
  const existing = database.prepare(
    "SELECT * FROM influence_decisions WHERE request_id=?",
  ).get(request.request_id) as DecisionRow | undefined;
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new Error("influence request ID is already bound to a different request");
    }
    const policy = database.prepare(
      "SELECT * FROM influence_policies WHERE policy_id=?",
    ).get(existing.policy_id) as PolicyRow | undefined;
    if (!policy) throw new Error("influence decision references a missing policy");
    return resultFromRows(request, policy, existing, true);
  }

  const policy = database.prepare(`
    SELECT * FROM influence_policies
    WHERE policy_version=(SELECT MAX(policy_version) FROM influence_policies)
      AND source_class=? AND domain=?
  `).get(request.source_class, request.domain) as PolicyRow | undefined;
  if (!policy) throw new Error("no active influence policy covers this source and domain");
  if (request.adopts_request_id) {
    if (request.source_class !== "mithra_explicit" || request.operation !== "write") {
      throw new Error("only an explicit Mithra write may adopt a reviewed proposal");
    }
    if (!request.payload_hash) throw new Error("adoption requires an exact payload hash");
    const proposed = database.prepare(
      "SELECT * FROM influence_decisions WHERE request_id=?",
    ).get(request.adopts_request_id) as DecisionRow | undefined;
    if (!proposed || proposed.decision !== "review" || proposed.operation !== "write") {
      throw new Error("adoption must reference an existing review decision");
    }
    if (proposed.domain !== request.domain || proposed.subject_ref !== request.subject_ref) {
      throw new Error("adoption domain and subject must match the reviewed proposal");
    }
    if (!proposed.payload_hash || proposed.payload_hash !== request.payload_hash) {
      throw new Error("adoption payload does not match the reviewed proposal");
    }
  }
  const decision = decisionFor(policy.authority, request.operation);
  const evaluatedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO influence_decisions
      (request_id,request_fingerprint,policy_id,policy_version,source_class,domain,operation,
       subject_ref,source_ref,authority,decision,evaluated_at,payload_hash,adopts_request_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    request.request_id, requestFingerprint, policy.policy_id, policy.policy_version,
    request.source_class, request.domain, request.operation, request.subject_ref,
    request.source_ref, policy.authority, decision, evaluatedAt,
    request.payload_hash ?? null, request.adopts_request_id ?? null,
  );
  const row = database.prepare(
    "SELECT * FROM influence_decisions WHERE request_id=?",
  ).get(request.request_id) as DecisionRow;
  return resultFromRows(request, policy, row, false);
}

export class InfluenceGateError extends Error {
  readonly result: InfluenceResult;
  constructor(result: InfluenceResult) {
    super(result.decision === "review"
      ? `influence write requires explicit adoption: ${result.source_class} may propose to ${result.domain} but may not write it`
      : `influence write denied: ${result.source_class} has no authority to write ${result.domain}`);
    this.name = "InfluenceGateError";
    this.result = result;
  }
}

export function authorizeInfluenceWrite(
  database: FeatherDatabase,
  context: InfluenceContext,
  domain: InfluenceDomain,
  subjectRef: string,
  payload: unknown,
): InfluenceResult {
  const parsed = influenceContextSchema.parse(context);
  const result = evaluateInfluence(database, {
    ...parsed,
    domain,
    operation: "write",
    subject_ref: subjectRef,
    payload_hash: hashInfluencePayload(payload),
  });
  if (result.decision !== "allow") throw new InfluenceGateError(result);
  return result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function hashInfluencePayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

/** Keep an admitted receipt and its protected mutation in one transaction; retain review/deny receipts. */
export function enforceInfluenceWrite<T>(
  database: FeatherDatabase,
  context: InfluenceContext,
  domain: InfluenceDomain,
  subjectRef: string,
  payload: unknown,
  mutate: () => T,
): T {
  const outcome = database.transaction(() => {
    try {
      const admitted = authorizeInfluenceWrite(database, context, domain, subjectRef, payload);
      if (admitted.replayed) {
        return { value: { replayed: true, request_id: admitted.request_id } as T } as const;
      }
    } catch (error) {
      if (error instanceof InfluenceGateError) return { error } as const;
      throw error;
    }
    return { value: mutate() } as const;
  })();
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/** Trusted in-process default for first-person ledgers. Network boundaries must supply context. */
export function internalMithraInfluence(sourceRef: string): InfluenceContext {
  return {
    request_id: randomUUID(),
    source_class: "mithra_explicit",
    source_ref: sourceRef,
  };
}

export function listInfluencePolicies(database: FeatherDatabase) {
  return database.prepare(`
    SELECT policy_id, policy_version, source_class, domain, authority, rationale
    FROM influence_policies ORDER BY domain, source_class
  `).all() as PolicyRow[];
}

export function listInfluenceDecisions(database: FeatherDatabase, limit = 50) {
  return database.prepare(`
    SELECT request_id, policy_id, policy_version, source_class, domain, operation,
      subject_ref, source_ref, authority, decision, evaluated_at, payload_hash, adopts_request_id
    FROM influence_decisions ORDER BY evaluated_at DESC, request_id DESC LIMIT ?
  `).all(Math.max(1, Math.min(limit, 100))) as Omit<DecisionRow, "request_fingerprint">[];
}
