import type { FeatherDatabase } from "../db.js";

export interface DirectiveSummary {
  active: number;
  byKind: Record<string, number>;
}

export interface RepairSummary {
  pending: number;
  applied: number;
}

export interface MemoryProvenanceHealth {
  total: number;
  by_class: Record<string, number>;
  suppressed: number;
}

interface KindRow {
  kind: string;
  n: number;
}

interface StatusRow {
  status: string;
  n: number;
}

export function activeDirectivesByKind(db: FeatherDatabase): DirectiveSummary {
  const rows = db
    .prepare("SELECT kind, COUNT(*) AS n FROM agency_directives WHERE status = 'active' GROUP BY kind")
    .all() as KindRow[];
  const byKind: Record<string, number> = {};
  let active = 0;
  for (const row of rows) {
    byKind[row.kind] = row.n;
    active += row.n;
  }
  return { active, byKind };
}

export function openHandRepairs(db: FeatherDatabase): RepairSummary {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM open_hand_repairs GROUP BY status")
    .all() as StatusRow[];
  let pending = 0;
  let applied = 0;
  for (const row of rows) {
    if (row.status === "pending") pending += row.n;
    else if (row.status === "applied") applied += row.n;
  }
  return { pending, applied };
}

export function memoryProvenanceHealth(db: FeatherDatabase): MemoryProvenanceHealth {
  const total = (db.prepare("SELECT COUNT(*) AS n FROM memory_provenance").get() as { n: number }).n;
  const byClass: Record<string, number> = {};
  const classRows = db
    .prepare(
      "SELECT provenance_class AS c, COUNT(*) AS n FROM memory_provenance WHERE suppress_flag=0 GROUP BY provenance_class",
    )
    .all() as Array<{ c: string; n: number }>;
  for (const row of classRows) byClass[row.c] = row.n;
  const suppressed = (db.prepare(
    "SELECT COUNT(*) AS n FROM memory_provenance WHERE suppress_flag=1",
  ).get() as { n: number }).n;
  return { total, by_class: byClass, suppressed };
}

