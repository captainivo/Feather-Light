import { z } from "zod";
import { agencyState } from "../agency.js";
import type { FeatherDatabase } from "../database.js";

export const agencyEnforcementSchema = z.object({
  tool_name: z.string().min(1).max(200),
  args: z.record(z.string(), z.union([
    z.string().max(1_000), z.number(), z.boolean(), z.array(z.string().max(1_000)).max(20),
  ])).default({}),
}).strict();

export type AgencyEnforcementInput = z.infer<typeof agencyEnforcementSchema>;
type Row = Record<string, string | number | null>;

const BLOCKING_KINDS = new Set(["refusal", "pause", "withdrawal"]);
const CONTACT_FIELDS = new Set([
  "recipient", "recipients", "to", "destination", "deliver", "chat_id", "channel", "peer", "phone", "email", "address",
]);
const RESOURCE_FIELDS = new Set([
  "path", "workdir", "url", "file", "filename", "source", "target", "source_path", "target_path", "from_path", "to_path",
]);

function scalarValues(value: string | number | boolean | string[]): string[] {
  return Array.isArray(value) ? value : [String(value)];
}

export function capabilityPaths(input: AgencyEnforcementInput): string[] {
  const toolName = input.tool_name.trim();
  const paths = new Set<string>([`tool:${toolName}`]);
  for (const [field, raw] of Object.entries(input.args)) {
    for (const value of scalarValues(raw)) {
      const clean = value.trim();
      if (!clean) continue;
      paths.add(`field:${field}=${clean}`);
      if (field === "action" || field === "operation") paths.add(`tool:${toolName}/${field}:${clean}`);
      if (CONTACT_FIELDS.has(field)) paths.add(`contact:${clean}`);
      if (RESOURCE_FIELDS.has(field)) paths.add(`resource:${clean}`);
    }
  }
  return [...paths].sort();
}

function canonicalSelector(scopeType: string, scopeValue: string): string | null {
  const value = scopeValue.trim();
  if (!value) return null;
  if (value.includes(":")) return value;
  if (scopeType === "tool_action") return `tool:${value}`;
  if (scopeType === "contact") return `contact:${value}`;
  if (scopeType === "resource") return `resource:${value}`;
  return null;
}

function selectorMatches(selector: string, candidate: string): boolean {
  if (selector.endsWith(":*")) return candidate.startsWith(selector.slice(0, -1));
  if (selector.endsWith("/**")) {
    const prefix = selector.slice(0, -3);
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }
  return selector === candidate;
}

export function evaluateAgencyEnforcement(database: FeatherDatabase, input: AgencyEnforcementInput) {
  if (input.tool_name === "mithra_agency") {
    return { blocked: false, exempt: true, reason: "agency_control_must_remain_reversible" };
  }
  const state = agencyState(database, "full");
  const directives = (state.active_directives ?? []) as Row[];
  const paths = capabilityPaths(input);
  for (const directive of directives) {
    if (!BLOCKING_KINDS.has(String(directive.kind))) continue;
    const scopeType = String(directive.scope_type);
    if (!["tool_action", "contact", "resource", "disclosure", "recording"].includes(scopeType)) continue;
    const selector = canonicalSelector(scopeType, String(directive.scope_value));
    if (!selector) continue;
    const matchedPath = paths.find((candidate) => selectorMatches(selector, candidate));
    if (!matchedPath) continue;
    return {
      blocked: true,
      matched_path: matchedPath,
      directive: {
        id: directive.id, revision: directive.revision, kind: directive.kind,
        scope_type: directive.scope_type, scope_value: directive.scope_value,
      },
      message: `Open Hand directive ${directive.id} blocks ${matchedPath}. Do not retry through an equivalent route or bargain for reversal.`,
    };
  }
  return { blocked: false, evaluated_directives: directives.length };
}
