import type { FeatherDatabase } from "../db.js";

export interface GrowthSummary {
  active: number;
  byKind: Record<string, number>;
}

export interface LongingSummary {
  privateHeld: number;
  sharedHeld: number;
  released: number;
}

interface CountRow {
  kind: string;
  n: number;
}

interface LongingRow {
  visibility: string;
  status: string;
  n: number;
}

export function growthSummary(db: FeatherDatabase): GrowthSummary {
  const rows = db
    .prepare("SELECT kind, COUNT(*) AS n FROM growth_entries WHERE status = 'active' GROUP BY kind")
    .all() as CountRow[];
  const byKind: Record<string, number> = {};
  let active = 0;
  for (const row of rows) {
    byKind[row.kind] = row.n;
    active += row.n;
  }
  return { active, byKind };
}

export function longingSummary(db: FeatherDatabase): LongingSummary {
  const rows = db
    .prepare("SELECT visibility, status, COUNT(*) AS n FROM longing_entries GROUP BY visibility, status")
    .all() as LongingRow[];
  const summary: LongingSummary = { privateHeld: 0, sharedHeld: 0, released: 0 };
  for (const row of rows) {
    if (row.status === "released") {
      summary.released += row.n;
    } else if (row.visibility === "private") {
      summary.privateHeld += row.n;
    } else {
      summary.sharedHeld += row.n;
    }
  }
  return summary;
}

