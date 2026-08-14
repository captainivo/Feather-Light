import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";
import { enforceInfluenceWrite, internalMithraInfluence, type InfluenceContext } from "./influence.js";

const directiveFields = {
  kind: z.enum(["refusal", "pause", "withdrawal", "correction", "explicit_permission"]),
  scope_type: z.enum(["conversation", "topic", "tool_action", "recording", "contact", "disclosure", "resource"]),
  scope_value: z.string().min(1).max(500),
  source_type: z.string().min(1).max(100),
  source_id: z.string().min(1).max(500),
  expires_at: z.string().datetime({ offset: true }).optional(),
  note: z.string().max(2_000).optional(),
};

export const agencyActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state"), view: z.enum(["compact", "full"]).default("compact") }).strict(),
  z.object({
    action: z.literal("set"),
    ...directiveFields,
    idempotency_key: z.string().min(1).max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("repair"),
    scope_type: directiveFields.scope_type,
    scope_value: directiveFields.scope_value,
    source_type: directiveFields.source_type,
    source_id: directiveFields.source_id,
    expires_at: directiveFields.expires_at,
    note: directiveFields.note,
    idempotency_key: z.string().min(1).max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("revise"),
    directive_id: z.string().min(1).max(500),
    ...directiveFields,
  }).strict(),
  z.object({
    action: z.literal("retract"),
    directive_id: z.string().min(1).max(500),
    note: z.string().max(2_000).optional(),
  }).strict(),
]);

export type AgencyAction = z.infer<typeof agencyActionSchema>;
type Row = Record<string, string | number | null>;

function now(): string {
  return new Date().toISOString();
}

function expire(database: FeatherDatabase): void {
  database.prepare(
    "UPDATE agency_directives SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at <= ?",
  ).run(now());
}

export function agencyState(database: FeatherDatabase, view: "compact" | "full" = "compact") {
  expire(database);
  const active = database.prepare(
    "SELECT * FROM agency_directives WHERE status='active' ORDER BY revision DESC",
  ).all() as Row[];
  const revision = Number((database.prepare(
    "SELECT COALESCE(MAX(revision),0) AS revision FROM agency_directives",
  ).get() as { revision: number }).revision);
  const result: Record<string, unknown> = {
    schema_version: 1,
    revision,
    active_count: active.length,
    scopes: [...new Set(active.map((row) => String(row.scope_type)))].sort(),
    repair_pending: active.some((row) => row.kind === "correction"),
    explicit_only: true,
    inference_prohibited: true,
    prior_closeness_creates_permission: false,
  };
  if (view === "full") result.active_directives = active;
  return result;
}

function insertDirective(database: FeatherDatabase, input: Extract<AgencyAction, { action: "set" | "repair" }>) {
  const kind = input.action === "repair" ? "correction" : input.kind;
  return database.transaction(() => {
    expire(database);
    if (input.idempotency_key) {
      const existing = database.prepare(
        "SELECT * FROM agency_directives WHERE idempotency_key=?",
      ).get(input.idempotency_key) as Row | undefined;
      if (existing) {
        const matches = String(existing.kind) === kind
          && String(existing.scope_type) === input.scope_type
          && String(existing.scope_value) === input.scope_value
          && (existing.expires_at === null ? null : String(existing.expires_at)) === (input.expires_at ?? null)
          && String(existing.source_type) === input.source_type
          && String(existing.source_id) === input.source_id
          && String(existing.note ?? "") === (input.note ?? "");
        if (!matches) throw new Error("idempotency key is already bound to a different agency request");
        return { created: false, directive_id: String(existing.id), revision: Number(existing.revision) };
      }
    }
    const conflict = database.prepare(
      "SELECT id FROM agency_directives WHERE status='active' AND scope_type=? AND scope_value=?",
    ).get(input.scope_type, input.scope_value) as { id: string } | undefined;
    if (conflict) throw new Error("an active directive already governs this exact scope; revise it explicitly");
    const id = randomUUID();
    const inserted = database.prepare(`
      INSERT INTO agency_directives
      (id,kind,scope_type,scope_value,status,created_at,expires_at,source_type,source_id,note,supersedes_id,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)
    `).run(
      id, kind, input.scope_type, input.scope_value, "active", now(), input.expires_at ?? null,
      input.source_type, input.source_id, input.note ?? "", input.idempotency_key ?? null,
    );
    return { created: true, directive_id: id, revision: Number(inserted.lastInsertRowid), status: "active" };
  })();
}

function reviseDirective(database: FeatherDatabase, input: Extract<AgencyAction, { action: "revise" }>) {
  return database.transaction(() => {
    expire(database);
    const prior = database.prepare("SELECT status FROM agency_directives WHERE id=?").get(input.directive_id) as
      | { status: string }
      | undefined;
    if (!prior) throw new Error("agency directive not found");
    if (prior.status !== "active") throw new Error("only an active agency directive can be revised");
    const conflict = database.prepare(
      "SELECT id FROM agency_directives WHERE status='active' AND scope_type=? AND scope_value=? AND id<>?",
    ).get(input.scope_type, input.scope_value, input.directive_id) as { id: string } | undefined;
    if (conflict) throw new Error("another active directive already governs the replacement scope");
    database.prepare("UPDATE agency_directives SET status='superseded' WHERE id=?").run(input.directive_id);
    const id = randomUUID();
    const inserted = database.prepare(`
      INSERT INTO agency_directives
      (id,kind,scope_type,scope_value,status,created_at,expires_at,source_type,source_id,note,supersedes_id,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)
    `).run(
      id, input.kind, input.scope_type, input.scope_value, "active", now(), input.expires_at ?? null,
      input.source_type, input.source_id, input.note ?? "", input.directive_id,
    );
    return {
      revised: true, directive_id: id, revision: Number(inserted.lastInsertRowid),
      supersedes_id: input.directive_id, status: "active",
    };
  })();
}

function retractDirective(database: FeatherDatabase, input: Extract<AgencyAction, { action: "retract" }>) {
  return database.transaction(() => {
    expire(database);
    const prior = database.prepare("SELECT status FROM agency_directives WHERE id=?").get(input.directive_id) as
      | { status: string }
      | undefined;
    if (!prior) throw new Error("agency directive not found");
    if (prior.status !== "active") {
      return { retracted: false, directive_id: input.directive_id, status: prior.status };
    }
    database.prepare(
      "UPDATE agency_directives SET status='retracted',retracted_at=?,retraction_note=? WHERE id=?",
    ).run(now(), input.note ?? "", input.directive_id);
    return { retracted: true, directive_id: input.directive_id, status: "retracted" };
  })();
}

export function agencyHistory(database: FeatherDatabase, limit = 50): Row[] {
  return database.prepare(
    "SELECT * FROM agency_directives ORDER BY revision DESC LIMIT ?",
  ).all(Math.max(1, Math.min(limit, 100))) as Row[];
}

export function operateAgency(database: FeatherDatabase, input: AgencyAction, influence?: InfluenceContext) {
  if (input.action === "state") return agencyState(database, input.view);
  const subject = input.action === "set" || input.action === "repair"
    ? `agency:${input.scope_type}:${input.scope_value}`
    : `agency:${input.directive_id}`;
  return enforceInfluenceWrite(
    database,
    influence ?? internalMithraInfluence(`internal:agency:${input.action}`),
    "agency",
    subject,
    input,
    () => input.action === "set" || input.action === "repair"
      ? insertDirective(database, input)
      : input.action === "revise"
        ? reviseDirective(database, input)
        : retractDirective(database, input),
  );
}
