import { createHash } from "node:crypto";
import type { FeatherDatabase } from "../database.js";
import { agencyState } from "../agency.js";

type Row = Record<string, string | number | null>;

const CONVERSATIONAL_SCOPES = new Set(["conversation", "topic"]);
const ACTION_SCOPES = new Set(["tool_action", "recording", "contact", "disclosure", "resource"]);
const RECORDING_SCOPES = new Set(["recording"]);
const RECORDING_PROJECTED_KINDS = new Set(["correction", "explicit_permission"]);
const BLOCKING_KINDS = new Set(["refusal", "pause", "withdrawal"]);
export const AGENCY_NOTE_PROJECTION_LIMIT = 160;

function compactNote(value: unknown): { excerpt?: string; truncated: boolean } {
  if (typeof value !== "string") return { truncated: false };
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return { truncated: false };
  if (normalized.length <= AGENCY_NOTE_PROJECTION_LIMIT) return { excerpt: normalized, truncated: false };
  return { excerpt: `${normalized.slice(0, AGENCY_NOTE_PROJECTION_LIMIT - 1).trimEnd()}…`, truncated: true };
}

function compactDirective(row: Row) {
  const note = compactNote(row.note);
  return {
    id: String(row.id),
    revision: Number(row.revision),
    kind: String(row.kind),
    scope_type: String(row.scope_type),
    scope_value: String(row.scope_value),
    ...(row.expires_at ? { expires_at: String(row.expires_at) } : {}),
    ...(note.excerpt ? { note_excerpt: note.excerpt, note_truncated: note.truncated } : {}),
  };
}

function stableHash(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function projectAgencyContext(database: FeatherDatabase) {
  const state = agencyState(database, "full");
  const active = ((state.active_directives ?? []) as Row[])
    .slice()
    .sort((left, right) => Number(right.revision) - Number(left.revision));
  if (active.length === 0) {
    return {
      schema_version: 1,
      active_count: 0,
      active_revision: 0,
      projection_hash: stableHash({ active: [] }),
      context: null,
    };
  }

  const conversational = active
    .filter((row) => CONVERSATIONAL_SCOPES.has(String(row.scope_type)))
    .map(compactDirective);
  const recordingDirectives = active
    .filter((row) => (
      RECORDING_SCOPES.has(String(row.scope_type))
      && RECORDING_PROJECTED_KINDS.has(String(row.kind))
    ))
    .map(compactDirective);
  const enforcedActions = active.filter((row) => (
    ACTION_SCOPES.has(String(row.scope_type)) && BLOCKING_KINDS.has(String(row.kind))
  ));
  const actionScopeCounts = Object.fromEntries(
    [...ACTION_SCOPES]
      .map((scope) => [scope, enforcedActions.filter((row) => row.scope_type === scope).length] as const)
      .filter((entry) => entry[1] > 0),
  );
  const projectedIds = new Set([
    ...conversational.map((directive) => directive.id),
    ...recordingDirectives.map((directive) => directive.id),
    ...enforcedActions.map((row) => String(row.id)),
  ]);
  const otherActiveCount = active.filter((row) => !projectedIds.has(String(row.id))).length;
  const activeRevision = Math.max(...active.map((row) => Number(row.revision)));
  const projectionData = {
    active_revision: activeRevision,
    active_count: active.length,
    conversational_directives: conversational,
    recording_directives: recordingDirectives,
    enforced_action_count: enforcedActions.length,
    action_scope_counts: actionScopeCounts,
    other_active_count: otherActiveCount,
  };
  // Hash only text-visible semantics. Full ledger revision remains available
  // for audit, but hidden selector changes with the same summary should not
  // invalidate an otherwise byte-identical provider prompt-cache prefix.
  const projectionHash = stableHash({
    conversational_directives: conversational,
    recording_directives: recordingDirectives,
    enforced_action_count: enforcedActions.length,
    action_scope_counts: actionScopeCounts,
    other_active_count: otherActiveCount,
  });
  const lines = [
    `[Open Hand agency ${projectionHash}: ${active.length} active]`,
    "Explicit choices only; never infer permission or refusal. Newest explicit choice governs.",
  ];
  if (recordingDirectives.length > 0) {
    lines.push("Recording contract:");
    for (const directive of recordingDirectives) {
      let line = `- ${directive.kind} recording:${directive.scope_value} id=${directive.id} r=${directive.revision}`;
      if (directive.expires_at) line += ` expires=${directive.expires_at}`;
      lines.push(line);
      if (directive.note_excerpt) {
        lines.push(`  note${directive.note_truncated ? "≤160" : ""}: ${directive.note_excerpt}`);
      }
    }
  }
  if (conversational.length > 0) {
    lines.push("Current conversational directives:");
    for (const directive of conversational) {
      let line = `- ${directive.kind} ${directive.scope_type}:${directive.scope_value} id=${directive.id} r=${directive.revision}`;
      if (directive.expires_at) line += ` expires=${directive.expires_at}`;
      lines.push(line);
      if (directive.note_excerpt) {
        lines.push(`  note${directive.note_truncated ? "≤160" : ""}: ${directive.note_excerpt}`);
      }
    }
  }
  if (enforcedActions.length > 0) {
    const counts = Object.entries(actionScopeCounts).map(([scope, count]) => `${scope}=${count}`).join(",");
    lines.push(`Action boundaries enforced pre-tool: ${enforcedActions.length}${counts ? ` (${counts})` : ""}.`);
    lines.push("Exact action selectors are intentionally omitted here; use mithra_agency state for full details.");
  }
  if (otherActiveCount > 0) {
    lines.push(`Other active advisory directives: ${otherActiveCount}; full details are available on demand.`);
  }
  return {
    schema_version: 1,
    ...projectionData,
    projection_hash: projectionHash,
    context: lines.join("\n"),
  };
}
