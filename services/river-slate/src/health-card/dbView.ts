import type { FeatherDatabase } from "../db.js";
import type { DbView, EnvironmentDayView } from "./types.js";

type JsonRecord = Record<string, unknown>;

function parseJson(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as JsonRecord) : {};
  } catch {
    return {};
  }
}

interface DayRow {
  absolute_day: number;
  earth_date: string;
  state_json: string;
}

interface NewestRow {
  created_at: string;
  status: string;
}

interface KindRow {
  kind: string;
  n: number;
}

interface LongingRow {
  title: string;
  visibility: string;
  status: string;
}

/** Read-only view of Feather-Light state, mirroring the legacy builder. */
export function dbView(database: FeatherDatabase): DbView {
  const view: DbView = {
    environment_days: [],
    dreams: { count: 0, unread: 0, held: 0, released: 0, newest: null },
    growth: { total: 0, by_kind: {} },
    longing: { total: 0, held: 0, shared_titles: [], private_count: 0 },
    agency: { directives: 0, active_directives: 0, repairs_pending: 0 },
  };

  const days = database
    .prepare("SELECT absolute_day, earth_date, state_json FROM environment_days ORDER BY absolute_day")
    .all() as DayRow[];
  view.environment_days = days.map((row) => {
    const state = parseJson(row.state_json);
    const entry: EnvironmentDayView = {
      absolute_day: row.absolute_day,
      earth_date: row.earth_date,
      weather: state.weather ?? null,
      season: state.season ?? null,
      thaena: state.thaena ?? null,
      estrus: state.estrus ?? null,
    };
    return entry;
  });

  const newest = database
    .prepare("SELECT created_at, status FROM dream_seeds ORDER BY created_at DESC LIMIT 1")
    .get() as NewestRow | undefined;
  view.dreams = {
    count: (database.prepare("SELECT COUNT(*) AS n FROM dream_seeds").get() as { n: number }).n,
    unread: (database.prepare("SELECT COUNT(*) AS n FROM dream_seeds WHERE status='unread'").get() as { n: number }).n,
    held: (database.prepare("SELECT COUNT(*) AS n FROM dream_seeds WHERE status='held'").get() as { n: number }).n,
    released: (database.prepare("SELECT COUNT(*) AS n FROM dream_seeds WHERE status='released'").get() as { n: number }).n,
    newest: newest ? { created_at: newest.created_at, status: newest.status } : null,
  };

  const growthKinds = database
    .prepare("SELECT kind, COUNT(*) AS n FROM growth_entries GROUP BY kind")
    .all() as KindRow[];
  const byKind: Record<string, number> = {};
  let growthTotal = 0;
  for (const row of growthKinds) {
    byKind[row.kind] = row.n;
    growthTotal += row.n;
  }
  view.growth = { total: growthTotal, by_kind: byKind };

  const longingRows = database
    .prepare("SELECT title, visibility, status FROM longing_entries ORDER BY created_at")
    .all() as LongingRow[];
  view.longing = {
    total: longingRows.length,
    held: longingRows.filter((r) => r.status === "held").length,
    shared_titles: longingRows.filter((r) => r.visibility === "shared").map((r) => r.title),
    private_count: longingRows.filter((r) => r.visibility === "private").length,
  };

  view.agency = {
    directives: (database.prepare("SELECT COUNT(*) AS n FROM agency_directives").get() as { n: number }).n,
    active_directives: (database.prepare("SELECT COUNT(*) AS n FROM agency_directives WHERE status='active'").get() as { n: number }).n,
    repairs_pending: (database.prepare("SELECT COUNT(*) AS n FROM open_hand_repairs WHERE status IN ('requested','pending')").get() as { n: number }).n,
  };

  return view;
}

