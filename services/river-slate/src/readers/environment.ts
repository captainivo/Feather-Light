import { z } from "zod";
import type { FeatherDatabase } from "../db.js";

const seasonSchema = z.object({
  name: z.string(),
  phase: z.string(),
  days_in_current_season: z.number(),
});

const weatherSchema = z.object({
  temperature_current_c: z.number(),
  wind_speed_kmh: z.number(),
  snow_depth_cm: z.number(),
  sky_condition: z.string(),
  daylight_hours: z.number(),
});

const estrusSchema = z.object({
  status: z.string(),
});

const thaenaSchema = z.object({
  visible: z.boolean(),
  direction: z.string().nullable(),
});

const environmentDaySchema = z.object({
  absolute_day: z.number(),
  earth_date: z.string(),
  generated_at: z.string(),
  season: seasonSchema,
  weather: weatherSchema,
  estrus: estrusSchema,
  thaena: thaenaSchema,
});

export type EnvironmentDay = z.infer<typeof environmentDaySchema>;

/** Latest environment day, which is TypeScript-generated where available. */
export function latestEnvironmentDay(db: FeatherDatabase): EnvironmentDay | null {
  const row = db
    .prepare("SELECT state_json FROM environment_days ORDER BY absolute_day DESC LIMIT 1")
    .get() as { state_json: string } | undefined;
  if (!row) return null;
  return environmentDaySchema.parse(JSON.parse(row.state_json));
}

