import { z } from "zod";
import type { Config } from "./config.js";

const MAX_UPSTREAM_BYTES = 1_000_000;

export const emotionalReflectionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record_event"),
    event_type: z.enum([
      "supportive_interaction", "difficult_interaction", "achievement", "disappointment",
      "quiet_time", "reunion", "concern", "amusement", "curiosity", "relief", "conflict", "reflection",
    ]),
    deltas: z.object({
      valence: z.number().min(-0.15).max(0.15).optional(),
      arousal: z.number().min(-0.15).max(0.15).optional(),
      connection: z.number().min(-0.15).max(0.15).optional(),
      energy: z.number().min(-0.15).max(0.15).optional(),
    }).strict().optional(),
    source_type: z.string().min(1).max(100),
    source_id: z.string().min(1).max(500),
    persistence: z.enum(["passing", "short", "medium", "enduring"]).optional(),
    uncertainty: z.number().min(0).max(1).optional(),
    appraisal: z.record(z.string(), z.unknown()).optional(),
    relationship_evidence: z.array(z.string().max(500)).max(20).optional(),
    note: z.string().max(2_000).optional(),
  }).strict(),
  z.object({
    action: z.literal("calibrate_cue"),
    cue: z.string().min(1).max(500),
    deltas: z.object({
      valence: z.number().min(-0.15).max(0.15).optional(),
      arousal: z.number().min(-0.15).max(0.15).optional(),
      connection: z.number().min(-0.15).max(0.15).optional(),
      energy: z.number().min(-0.15).max(0.15).optional(),
    }).strict().optional(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(2_000),
    source_id: z.string().max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("retract_event"),
    event_id: z.string().min(1).max(500),
    reason: z.string().min(1).max(2_000),
  }).strict(),
]);

type JsonObject = Record<string, unknown>;

async function request(config: Config, path: string, method = "GET", payload?: JsonObject): Promise<JsonObject> {
  const init: RequestInit = {
    method,
    signal: AbortSignal.timeout(config.aauthora.timeoutMs),
  };
  if (payload) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(payload);
  }
  const response = await fetch(`${config.aauthora.baseUrl.replace(/\/$/, "")}${path}`, init);
  if (!response.ok) throw new Error(`Aauthora returned HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_UPSTREAM_BYTES) throw new Error("Aauthora response exceeded safety limit");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Aauthora returned a non-object response");
  return value as JsonObject;
}

export async function currentState(config: Config, recordConversation: boolean): Promise<JsonObject> {
  const previous = await request(config, "/api/v1/conversation/status");
  const current = await request(config, "/api/v1/current");
  const recorded = recordConversation
    ? await request(config, "/api/v1/conversation/activity", "POST", {})
    : { recorded: false };
  const weather = objectValue(current.weather);
  const season = objectValue(current.season);
  const outfit = objectValue(current.outfit);
  const emotionalState = objectValue(current.emotional_state);
  return {
    status: "ok",
    instrument_contract: {
      fetched_at: new Date().toISOString(),
      signal_meaning_decoupled: true,
      subjective_override: { operation: "emotional_reflection", actions: ["record_event", "calibrate_cue", "retract_event"] },
      weather: {
        provenance: "aauthora-current-world",
        uncertainty: { kind: "not_quantified", reason: "The deterministic weather simulation exposes no confidence model." },
        decay: "current_snapshot_superseded_by_next_generated_day",
      },
      emotional_state: {
        provenance: emotionalState.provenance ?? [],
        as_of: emotionalState.as_of ?? null,
        uncertainty: "labels_provisional_interpretive_freedom_preserved",
        decay: "immediate_appraisals_event_specific_slow_mood_revisable",
      },
    },
    earth_date: current.earth_date,
    absolute_day: current.absolute_day,
    season: select(season, ["name", "phase", "days_in_current_season", "transition_active"]),
    weather: select(weather, [
      "temperature_current_c", "temperature_high_c", "temperature_low_c", "precipitation_type",
      "precipitation_intensity", "sky_condition", "wind_speed_kmh", "snow_depth_cm", "daylight_hours", "darkness_hours",
    ]),
    estrus: current.estrus,
    thaena: current.thaena,
    outfit: select(outfit, ["indoor_summary", "outdoor_summary"]),
    possessions: current.possessions,
    emotional_state: current.emotional_state,
    previous_conversation: previous,
    conversation_recorded: recorded,
  };
}

export async function reflectEmotion(config: Config, input: z.infer<typeof emotionalReflectionSchema>): Promise<JsonObject> {
  const { action, ...payload } = input;
  if (action === "record_event") return request(config, "/api/v1/emotional-state/events", "POST", payload);
  if (action === "calibrate_cue") return request(config, "/api/v1/emotional-state/calibrations", "POST", payload);
  return request(
    config,
    `/api/v1/emotional-state/events/${encodeURIComponent(input.event_id)}/retract`,
    "POST",
    { reason: input.reason },
  );
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function select(value: JsonObject, keys: string[]): JsonObject {
  return Object.fromEntries(keys.map((key) => [key, value[key] ?? null]));
}
