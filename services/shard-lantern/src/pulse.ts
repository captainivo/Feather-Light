import type { Config } from "./config.js";
import type { ShardDatabase } from "./db.js";
import type { Pulse, PulseEntry } from "./types.js";

export interface CivilClock {
  hour: number | null;
  dayLengthHours: number;
  progress: number | null;
}

interface CivilTime {
  hours_elapsed?: number;
  total_day_length_hours?: number;
  progress?: number;
}

/** Ask Granite-Wing's current_state operation for the Westpole's civil clock. */
export async function fetchCivilClock(config: Config): Promise<CivilClock> {
  try {
    const res = await fetch(`${config.retrievalApiUrl}/v1/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "current_state",
        scope: "weather",
        recordConversation: false,
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { hour: null, dayLengthHours: 35.9, progress: null };
    const body = (await res.json()) as { civil_time?: CivilTime };
    const ct = body?.civil_time;
    if (!ct) return { hour: null, dayLengthHours: 35.9, progress: null };
    const dayLength = ct.total_day_length_hours ?? 35.9;
    const hour =
      ct.hours_elapsed ??
      (typeof ct.progress === "number" ? ct.progress * dayLength : null);
    return {
      hour,
      dayLengthHours: dayLength,
      progress: ct.progress ?? (hour != null ? hour / dayLength : null),
    };
  } catch {
    return { hour: null, dayLengthHours: 35.9, progress: null };
  }
}

/** Resolve what everyone is doing at a given civil hour. */
export function buildPulse(
  db: ShardDatabase,
  hour: number | null,
  dayLengthHours = 35.9
): Pulse {
  const inhabitants = db
    .prepare("SELECT slug, name, home FROM inhabitants ORDER BY name")
    .all() as Array<{ slug: string; name: string; home: string }>;

  const routineStmt = db.prepare(
    `SELECT location, activity FROM routines
     WHERE inhabitant_id = ? AND ? >= window_start AND ? < window_end
     ORDER BY window_start LIMIT 1`
  );

  const entries: PulseEntry[] = inhabitants.map((inh) => {
    if (hour == null) {
      return {
        slug: inh.slug,
        name: inh.name,
        home: inh.home,
        location: inh.home,
        activity: "about the Westpole",
      };
    }
    const r = routineStmt.get(inh.slug, hour, hour) as
      | { location: string; activity: string }
      | undefined;
    return {
      slug: inh.slug,
      name: inh.name,
      home: inh.home,
      location: r?.location ?? inh.home,
      activity: r?.activity ?? "about the Westpole",
    };
  });

  return {
    status: hour == null ? "clock_unavailable" : "ok",
    hour,
    day_length_hours: dayLengthHours,
    day_progress: hour != null ? Math.min(1, Math.max(0, hour / dayLengthHours)) : null,
    inhabitants: entries,
  };
}

