import { randomUUID } from "node:crypto";
import type { FeatherDatabase } from "./database.js";

export const PROVENANCE_CLASSES = [
  "literal",
  "narrated",
  "playful",
  "hypothetical",
  "quoted",
  "uncertain",
  "corrected",
] as const;

export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

export interface MemoryProvenanceRow {
  id: string;
  peer: string;
  record_key: string;
  provenance_class: ProvenanceClass;
  source_ref: string | null;
  original_class: ProvenanceClass | null;
  corrected_from: ProvenanceClass | null;
  correction_note: string | null;
  suppress_flag: 0 | 1;
  created_at: string;
  updated_at: string;
}

function now(): string {
  return new Date().toISOString();
}

export function assertProvenanceClass(value: string): ProvenanceClass {
  if (!(PROVENANCE_CLASSES as readonly string[]).includes(value)) {
    throw new Error(
      `memory provenance class must be one of: ${PROVENANCE_CLASSES.join(", ")}`,
    );
  }
  return value as ProvenanceClass;
}

export function recordMemoryProvenance(
  database: FeatherDatabase,
  input: {
    peer: string;
    record_key: string;
    provenance_class: string;
    source_ref?: string | null;
    correction_note?: string | null;
  },
): { id: string; created: boolean; provenance_class: ProvenanceClass; suppress_flag: 0 | 1 } {
  const cls = assertProvenanceClass(input.provenance_class);
  const existing = database.prepare(
    "SELECT * FROM memory_provenance WHERE peer=? AND record_key=? ORDER BY updated_at DESC LIMIT 1",
  ).get(input.peer, input.record_key) as MemoryProvenanceRow | undefined;
  if (!existing) {
    const id = randomUUID();
    database.prepare(`
      INSERT INTO memory_provenance
        (id, peer, record_key, provenance_class, source_ref, original_class, corrected_from,
         correction_note, suppress_flag, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.peer, input.record_key, cls, input.source_ref ?? null,
      cls, null, input.correction_note ?? null, 0, now(), now(),
    );
    return { id, created: true, provenance_class: cls, suppress_flag: 0 };
  }
  const id = existing.id;
  const wasCorrected = existing.provenance_class !== cls;
  database.prepare(`
    UPDATE memory_provenance
    SET provenance_class=?, source_ref=COALESCE(?, source_ref),
        corrected_from=CASE WHEN ? THEN ? ELSE corrected_from END,
        correction_note=CASE WHEN ? THEN COALESCE(?, correction_note) ELSE correction_note END,
        updated_at=?
    WHERE id=?
  `).run(
    cls, input.source_ref ?? null,
    wasCorrected ? 1 : 0, existing.provenance_class,
    wasCorrected ? 1 : 0, input.correction_note ?? null,
    now(), id,
  );
  const refreshed = database.prepare(
    "SELECT provenance_class, suppress_flag FROM memory_provenance WHERE id=?",
  ).get(id) as { provenance_class: ProvenanceClass; suppress_flag: 0 | 1 };
  return { id, created: false, provenance_class: refreshed.provenance_class, suppress_flag: refreshed.suppress_flag };
}

export function correctMemoryProvenance(
  database: FeatherDatabase,
  input: { peer: string; record_key: string; correction_note?: string | null },
): { id: string; corrected_from: ProvenanceClass; provenance_class: ProvenanceClass } | null {
  const existing = database.prepare(
    "SELECT * FROM memory_provenance WHERE peer=? AND record_key=? ORDER BY updated_at DESC LIMIT 1",
  ).get(input.peer, input.record_key) as MemoryProvenanceRow | undefined;
  if (!existing) return null;
  if (existing.provenance_class === "corrected") {
    return {
      id: existing.id,
      corrected_from: existing.corrected_from ?? existing.original_class ?? existing.provenance_class,
      provenance_class: "corrected",
    };
  }
  database.prepare(`
    UPDATE memory_provenance
    SET provenance_class='corrected', corrected_from=?, correction_note=COALESCE(?, correction_note), updated_at=?
    WHERE id=?
  `).run(existing.provenance_class, input.correction_note ?? null, now(), existing.id);
  return {
    id: existing.id,
    corrected_from: existing.provenance_class,
    provenance_class: "corrected",
  };
}

export function setMemorySuppression(
  database: FeatherDatabase,
  input: { peer: string; record_key: string; suppress: boolean; correction_note?: string | null },
): { id: string; suppress_flag: 0 | 1 } | null {
  const existing = database.prepare(
    "SELECT id FROM memory_provenance WHERE peer=? AND record_key=? ORDER BY updated_at DESC LIMIT 1",
  ).get(input.peer, input.record_key) as { id: string } | undefined;
  if (!existing) return null;
  const flag: 0 | 1 = input.suppress ? 1 : 0;
  database.prepare(`
    UPDATE memory_provenance
    SET suppress_flag=?, correction_note=COALESCE(?, correction_note), updated_at=?
    WHERE id=?
  `).run(flag, input.correction_note ?? null, now(), existing.id);
  return { id: existing.id, suppress_flag: flag };
}

export interface MemoryAdmissionResult {
  allowed: boolean;
  suppressed: boolean;
  denied_reason?: string;
  suggested_class?: ProvenanceClass;
  provenance: MemoryProvenanceRow | null;
}

export function evaluateMemoryAdmission(
  database: FeatherDatabase,
  input: {
    peer: string;
    record_key: string;
    proposed_class: string;
    source_ref?: string | null;
  },
): MemoryAdmissionResult {
  const cls = assertProvenanceClass(input.proposed_class);
  const known = database.prepare(
    "SELECT * FROM memory_provenance WHERE peer=? AND record_key=? ORDER BY updated_at DESC LIMIT 1",
  ).get(input.peer, input.record_key) as MemoryProvenanceRow | undefined;

  if (known) {
    if (known.suppress_flag === 1) {
      return {
        allowed: false, suppressed: true,
        denied_reason: "record is suppressed from derived retrieval",
        suggested_class: "corrected", provenance: known,
      };
    }
    if (known.provenance_class === "corrected") {
      return {
        allowed: false, suppressed: false,
        denied_reason: `record is corrected to '${known.corrected_from ?? "corrected"}' (${known.correction_note ?? "no note"})`,
        suggested_class: known.corrected_from ?? "corrected", provenance: known,
      };
    }
    if (known.provenance_class !== cls) {
      return {
        allowed: false, suppressed: false,
        denied_reason: `proposed class '${cls}' conflicts with recorded class '${known.provenance_class}'`,
        suggested_class: known.provenance_class, provenance: known,
      };
    }
    return { allowed: true, suppressed: false, provenance: known };
  }

  const created = recordMemoryProvenance(database, {
    peer: input.peer, record_key: input.record_key,
    provenance_class: cls, source_ref: input.source_ref ?? null,
  });
  const row = database.prepare(
    "SELECT * FROM memory_provenance WHERE id=?",
  ).get(created.id) as MemoryProvenanceRow;
  return { allowed: true, suppressed: false, provenance: row };
}
