import { z } from "zod";

/** The Aauthora current-conditions snapshot, as served by the env API. */
export const currentSchema = z
  .object({
    earth_date: z.string().optional(),
    absolute_day: z.number().optional(),
    emotional_state: z
      .object({
        valence: z.number().optional(),
        arousal: z.number().optional(),
        connection: z.number().optional(),
        energy: z.number().optional(),
      })
      .passthrough()
      .optional(),
    weather: z
      .object({
        temperature_current_c: z.number().optional(),
        sky_condition: z.string().optional(),
        snow_depth_cm: z.number().optional(),
        daylight_hours: z.number().optional(),
      })
      .passthrough()
      .optional(),
    season: z
      .object({ name: z.string().optional(), phase: z.string().optional() })
      .passthrough()
      .optional(),
    estrus: z
      .object({ status: z.string().optional() })
      .passthrough()
      .optional(),
    possessions: z
      .object({ pending_gift_reviews: z.number().optional() })
      .passthrough()
      .optional(),
    conversation_recorded: z
      .object({
        earth_days_since_last_conversation: z.number().optional(),
        last_conversation_earth_date: z.string().optional(),
      })
      .passthrough()
      .optional(),
    civil_time: z
      .object({ time: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type CurrentSnapshot = z.infer<typeof currentSchema>;

export interface EnvironmentDayView {
  absolute_day: number;
  earth_date: string;
  weather: unknown;
  season: unknown;
  thaena: unknown;
  estrus: unknown;
}

export interface DbView {
  environment_days: EnvironmentDayView[];
  dreams: {
    count: number;
    unread: number;
    held: number;
    released: number;
    newest: { created_at: string; status: string } | null;
  };
  growth: {
    total: number;
    by_kind: Record<string, number>;
  };
  longing: {
    total: number;
    held: number;
    shared_titles: string[];
    private_count: number;
  };
  agency: {
    directives: number;
    active_directives: number;
    repairs_pending: number;
  };
}

export interface LightState {
  level: string;
  source: string;
  note: string;
}

export type Lights = Record<string, LightState>;

export interface Snapshot {
  ts: string;
  earth_date: string | null;
  absolute_day: number | null;
  valence: number | null;
  arousal: number | null;
  connection: number | null;
  energy: number | null;
  temperature_current_c: number | null;
}

export interface HistoryFile {
  schema_version: number;
  snapshots: Snapshot[];
}

export interface HealthCard {
  schema_version: number;
  generated_at: string;
  current: CurrentSnapshot;
  environment: DbView;
  lights: Lights;
  self_audit: Record<string, unknown> | null;
  history: HistoryFile;
}

