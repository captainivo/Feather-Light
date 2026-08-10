import type { FeatherDatabase } from "../db.js";

export interface DirectiveSummary {
  active: number;
  byKind: Record<string, number>;
}

export interface RepairSummary {
  pending: number;
  applied: number;
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

