import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FeatherDatabase } from "../database.js";
import { activeRetrievalSuppressions } from "./suppression.js";

const intents = [
  "correct_objective_error", "append_context", "change_interpretation",
  "supersede", "retract", "suppress_retrieval", "delete",
] as const;
const storageSystems = [
  "feather_light_index", "agency_ledger", "aauthora_emotional",
  "notebook", "hermes_memory", "honcho", "hermes_session",
  "provider", "backup", "canonical_archive",
] as const;
const selectorTypes = [
  "source_file_id", "relative_path", "section_id", "entity_id", "record_id", "session_id", "content_hash",
] as const;

type Intent = (typeof intents)[number];
type StorageSystem = (typeof storageSystems)[number];
type CapabilityMode = "native" | "existing_control" | "external_adapter" | "manual" | "unsupported" | "unknown";

const sourceFields = {
  source_type: z.string().min(1).max(100),
  source_id: z.string().min(1).max(500),
};

export const repairActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("capabilities") }).strict(),
  z.object({
    action: z.literal("state"),
    status: z.enum(["pending", "applied", "external_required", "retracted", "rejected"]).optional(),
    storage_system: z.enum(storageSystems).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }).strict(),
  z.object({
    action: z.literal("plan"),
    intent: z.enum(intents),
    storage_system: z.enum(storageSystems),
    selector_type: z.enum(selectorTypes),
    selector_value: z.string().min(1).max(2_000),
    correction_text: z.string().min(1).max(8_000).optional(),
    note: z.string().max(4_000).optional(),
    idempotency_key: z.string().min(1).max(500).optional(),
    ...sourceFields,
  }).strict(),
  z.object({
    action: z.literal("apply"),
    repair_id: z.string().uuid(),
    confirm_intent: z.enum(intents),
  }).strict(),
  z.object({
    action: z.literal("retract"),
    repair_id: z.string().uuid(),
    note: z.string().max(4_000).optional(),
  }).strict(),
]);

export type RepairAction = z.infer<typeof repairActionSchema>;

const capabilityRegistry: Record<StorageSystem, {
  authority: string;
  modes: Partial<Record<Intent, CapabilityMode>>;
  limits: string[];
}> = {
  feather_light_index: {
    authority: "Feather-Light SQLite retrieval index; source documents remain read-only and unchanged.",
    modes: { suppress_retrieval: "native" },
    limits: ["Suppression is reversible and affects retrieval, not source bytes.", "Physical deletion is not implemented."],
  },
  agency_ledger: {
    authority: "Feather-Light append-only agency ledger.",
    modes: { supersede: "existing_control", retract: "existing_control", correct_objective_error: "existing_control" },
    limits: ["Use mithra_agency revise/retract/repair.", "Historical rows are preserved; there is no physical-delete operation."],
  },
  aauthora_emotional: {
    authority: "Aauthora emotional-state service.",
    modes: { retract: "external_adapter", append_context: "external_adapter", change_interpretation: "external_adapter" },
    limits: ["Requires Aauthora event-specific identifiers and its own verified retraction path."],
  },
  notebook: {
    authority: "Writable notebook files, with some separate read-only/canonical roots.",
    modes: { correct_objective_error: "manual", append_context: "manual", supersede: "manual", delete: "manual" },
    limits: ["A precise file operation is required.", "Read-only and canonical roots cannot be silently rewritten."],
  },
  hermes_memory: {
    authority: "Hermes persistent memory store.",
    modes: { correct_objective_error: "external_adapter", supersede: "external_adapter", retract: "external_adapter", delete: "external_adapter" },
    limits: ["Requires an exact memory-store entry and the Hermes memory tool; this service does not claim completion."],
  },
  honcho: {
    authority: "Honcho peer conclusions and derived context.",
    modes: { correct_objective_error: "external_adapter", append_context: "external_adapter", delete: "external_adapter" },
    limits: ["Conclusion deletion is restricted to PII removal.", "Derived context may self-heal rather than physically disappear."],
  },
  hermes_session: {
    authority: "Hermes session transcripts and metadata.",
    modes: { suppress_retrieval: "external_adapter", delete: "external_adapter" },
    limits: ["Session-specific verification is required; deleting a session is not deletion from providers or backups."],
  },
  provider: {
    authority: "External model/provider infrastructure.",
    modes: {},
    limits: ["No verified deletion adapter is available from Feather-Light."],
  },
  backup: {
    authority: "Host or external backup infrastructure.",
    modes: {},
    limits: ["No verified deletion adapter is available from Feather-Light."],
  },
  canonical_archive: {
    authority: "Read-only canonical archive.",
    modes: { append_context: "manual", change_interpretation: "manual" },
    limits: ["Canonical source is not rewritten by Open Hand.", "Corrections belong in an authorized working layer."],
  },
};

function capabilityMode(storage: StorageSystem, intent: Intent): CapabilityMode {
  const explicit = capabilityRegistry[storage].modes[intent];
  if (explicit) return explicit;
  if (intent === "delete") return "unsupported";
  return storage === "provider" || storage === "backup" ? "unknown" : "unsupported";
}

export function repairCapabilities(): object {
  return {
    automatic_deletion: false,
    intent_separation_required: true,
    systems: Object.entries(capabilityRegistry).map(([storageSystem, value]) => ({
      storageSystem,
      authority: value.authority,
      modes: Object.fromEntries(intents.map((intent) => [intent, capabilityMode(storageSystem as StorageSystem, intent)])),
      limits: value.limits,
    })),
  };
}

function row(database: FeatherDatabase, repairId: string) {
  return database.prepare(`
    SELECT repair_id AS repairId, requested_at AS requestedAt, intent,
      storage_system AS storageSystem, selector_type AS selectorType,
      selector_value AS selectorValue, correction_text AS correctionText,
      note, source_type AS sourceType, source_id AS sourceId,
      idempotency_key AS idempotencyKey, capability_mode AS capabilityMode,
      status, applied_at AS appliedAt, retracted_at AS retractedAt,
      result_json AS resultJson
    FROM open_hand_repairs WHERE repair_id=?
  `).get(repairId) as Record<string, unknown> | undefined;
}

function resolveSuppressionTarget(
  database: FeatherDatabase,
  selectorType: string,
  selectorValue: string,
): { selectorType: string; selectorValue: string } | null {
  if (selectorType === "source_file_id") {
    return database.prepare("SELECT 1 FROM source_files WHERE source_file_id=? AND deleted=0").get(selectorValue)
      ? { selectorType, selectorValue } : null;
  }
  if (selectorType === "relative_path") {
    const matches = database.prepare(
      "SELECT source_file_id AS sourceFileId FROM source_files WHERE relative_path=? AND deleted=0 ORDER BY root_id",
    ).all(selectorValue) as Array<{ sourceFileId: string }>;
    if (matches.length > 1) throw new Error("relative_path suppression target is ambiguous across archive roots; use source_file_id");
    return matches[0] ? { selectorType: "source_file_id", selectorValue: matches[0].sourceFileId } : null;
  }
  if (selectorType === "section_id") {
    return database.prepare("SELECT 1 FROM source_sections s JOIN source_files f ON f.source_file_id=s.source_file_id WHERE s.section_id=? AND f.deleted=0").get(selectorValue)
      ? { selectorType, selectorValue } : null;
  }
  if (selectorType === "entity_id") {
    return database.prepare("SELECT 1 FROM entities WHERE entity_id=? AND retired=0").get(selectorValue)
      ? { selectorType, selectorValue } : null;
  }
  return null;
}

function plan(database: FeatherDatabase, action: Extract<RepairAction, { action: "plan" }>) {
  if (["correct_objective_error", "append_context", "change_interpretation"].includes(action.intent) && !action.correction_text) {
    throw new Error(`${action.intent} requires correction_text`);
  }
  const mode = capabilityMode(action.storage_system, action.intent);
  const status = mode === "native" ? "pending" : mode === "unsupported" ? "rejected" : "external_required";
  if (action.idempotency_key) {
    const existing = database.prepare("SELECT * FROM open_hand_repairs WHERE idempotency_key=?").get(action.idempotency_key) as Record<string, unknown> | undefined;
    if (existing) {
      const matches = String(existing.intent) === action.intent
        && String(existing.storage_system) === action.storage_system
        && String(existing.selector_type) === action.selector_type
        && String(existing.selector_value) === action.selector_value
        && (existing.correction_text === null ? null : String(existing.correction_text)) === (action.correction_text ?? null)
        && (existing.note === null ? null : String(existing.note)) === (action.note ?? null)
        && String(existing.source_type) === action.source_type
        && String(existing.source_id) === action.source_id;
      if (!matches) throw new Error("idempotency key is already bound to a different repair request");
      return { created: false, repair: row(database, String(existing.repair_id)) };
    }
  }
  const repairId = randomUUID();
  database.prepare(`
    INSERT INTO open_hand_repairs(
      repair_id, requested_at, intent, storage_system, selector_type, selector_value,
      correction_text, note, source_type, source_id, idempotency_key,
      capability_mode, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    repairId, new Date().toISOString(), action.intent, action.storage_system,
    action.selector_type, action.selector_value, action.correction_text ?? null,
    action.note ?? null, action.source_type, action.source_id,
    action.idempotency_key ?? null, mode, status,
  );
  return { created: true, repair: row(database, repairId) };
}

function apply(database: FeatherDatabase, action: Extract<RepairAction, { action: "apply" }>) {
  return database.transaction(() => {
    const repair = row(database, action.repair_id);
    if (!repair) throw new Error("repair not found");
    if (repair.status !== "pending") throw new Error(`repair is not pending: ${String(repair.status)}`);
    if (repair.intent !== action.confirm_intent) throw new Error("confirm_intent does not match the planned repair");
    if (repair.capabilityMode !== "native" || repair.storageSystem !== "feather_light_index" || repair.intent !== "suppress_retrieval") {
      throw new Error("repair has no native apply adapter");
    }
    const requestedSelectorType = String(repair.selectorType);
    const requestedSelectorValue = String(repair.selectorValue);
    if (!["source_file_id", "relative_path", "section_id", "entity_id"].includes(requestedSelectorType)) {
      throw new Error("selector is not supported for index suppression");
    }
    const resolved = resolveSuppressionTarget(database, requestedSelectorType, requestedSelectorValue);
    if (!resolved) throw new Error("suppression target not found");
    const { selectorType, selectorValue } = resolved;
    const suppressionId = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO retrieval_suppressions(
        suppression_id, repair_id, selector_type, selector_value, status, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?)
    `).run(suppressionId, action.repair_id, selectorType, selectorValue, now);
    const result = JSON.stringify({ suppressionId, selectorType, selectorValue, source_deleted: false });
    database.prepare("UPDATE open_hand_repairs SET status='applied', applied_at=?, result_json=? WHERE repair_id=?")
      .run(now, result, action.repair_id);
    return { applied: true, source_deleted: false, repair: row(database, action.repair_id) };
  })();
}

function retract(database: FeatherDatabase, action: Extract<RepairAction, { action: "retract" }>) {
  return database.transaction(() => {
    const repair = row(database, action.repair_id);
    if (!repair) throw new Error("repair not found");
    if (repair.status === "retracted") return { retracted: true, repair };
    const now = new Date().toISOString();
    if (repair.status === "applied") {
      database.prepare("UPDATE retrieval_suppressions SET status='retracted', retracted_at=? WHERE repair_id=? AND status='active'")
        .run(now, action.repair_id);
    }
    if (action.note) {
      database.prepare("UPDATE open_hand_repairs SET note=CASE WHEN note IS NULL OR note='' THEN ? ELSE note || char(10) || ? END WHERE repair_id=?")
        .run(action.note, action.note, action.repair_id);
    }
    database.prepare("UPDATE open_hand_repairs SET status='retracted', retracted_at=? WHERE repair_id=?")
      .run(now, action.repair_id);
    return { retracted: true, repair: row(database, action.repair_id) };
  })();
}

function state(database: FeatherDatabase, action: Extract<RepairAction, { action: "state" }>) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (action.status) { clauses.push("status=?"); params.push(action.status); }
  if (action.storage_system) { clauses.push("storage_system=?"); params.push(action.storage_system); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const repairs = database.prepare(`
    SELECT repair_id AS repairId, requested_at AS requestedAt, intent,
      storage_system AS storageSystem, selector_type AS selectorType,
      selector_value AS selectorValue, correction_text AS correctionText,
      note, source_type AS sourceType, source_id AS sourceId,
      capability_mode AS capabilityMode, status,
      applied_at AS appliedAt, retracted_at AS retractedAt,
      result_json AS resultJson
    FROM open_hand_repairs ${where}
    ORDER BY requested_at DESC, repair_id DESC LIMIT ?
  `).all(...params, action.limit);
  return { repairs, activeSuppressions: activeRetrievalSuppressions(database), automatic_deletion: false };
}

export function operateRepair(database: FeatherDatabase, action: RepairAction): object {
  if (action.action === "capabilities") return repairCapabilities();
  if (action.action === "state") return state(database, action);
  if (action.action === "plan") return plan(database, action);
  if (action.action === "apply") return apply(database, action);
  return retract(database, action);
}
