import { z } from "zod";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { aauthoranClock, catchUpEnvironment, importLegacyEnvironment, latestEnvironment } from "./environment.js";

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

async function requestArray(config: Config, path: string): Promise<JsonObject[]> {
  const response = await fetch(`${config.aauthora.baseUrl.replace(/\/$/, "")}${path}`, {
    signal: AbortSignal.timeout(config.aauthora.timeoutMs),
  });
  if (!response.ok) throw new Error(`Aauthora returned HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_UPSTREAM_BYTES) throw new Error("Aauthora response exceeded safety limit");
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("Aauthora returned a non-object history response");
  }
  return value as JsonObject[];
}

export type CurrentStateScope = "weather" | "summary" | "full";

export async function ensureEnvironmentCurrent(config: Config, database: FeatherDatabase) {
  let environment = latestEnvironment(database);
  if (!environment) {
    const history = await requestArray(config, "/api/v1/days?count=32");
    if (history.length === 0) throw new Error("legacy environment history is empty");
    for (const legacy of history) environment = importLegacyEnvironment(database, legacy);
  }
  if (!environment) throw new Error("environment initialization failed");
  const generated = catchUpEnvironment(database, config);
  return { current: latestEnvironment(database) ?? environment, generated };
}

export async function currentState(
  config: Config,
  database: FeatherDatabase,
  recordConversation: boolean,
  scope: CurrentStateScope = "summary",
  agencyState?: JsonObject,
): Promise<JsonObject> {
  const ensured = await ensureEnvironmentCurrent(config, database);
  const environment = ensured.current;
  const previous = scope === "weather" ? null : await request(config, "/api/v1/conversation/status");
  const current = scope === "weather" ? {} : await request(config, "/api/v1/current");
  const recorded = recordConversation
    ? await request(config, "/api/v1/conversation/activity", "POST", {})
    : { recorded: false };
  const weather = objectValue(environment.weather);
  const season = objectValue(environment.season);
  const outfit = objectValue(current.outfit);
  const possessions = objectValue(current.possessions);
  const emotionalState = objectValue(current.emotional_state);
  const agency = agencyState ?? objectValue(current.agency);
  const fetchedAt = new Date().toISOString();
  const civilTime = aauthoranClock(config, environment);
  const weatherContract = {
    provenance: "feather-light-environment",
    uncertainty: { kind: "not_quantified", reason: "The deterministic weather simulation exposes no confidence model." },
    decay: "current_snapshot_superseded_by_next_generated_day",
  };
  const common = {
    status: "ok",
    scope,
    instrument_contract: {
      fetched_at: fetchedAt,
      signal_meaning_decoupled: true,
      weather: weatherContract,
    },
    earth_date: environment.earth_date,
    absolute_day: environment.absolute_day,
    civil_time: civilTime,
    season: select(season, ["name", "phase", "days_in_current_season", "transition_active"]),
    weather: select(weather, [
      "temperature_current_c", "temperature_high_c", "temperature_low_c", "precipitation_type",
      "precipitation_intensity", "sky_condition", "wind_speed_kmh", "wind_gust_kmh", "wind_direction",
      "snow_depth_cm", "ice_accumulation_mm", "daylight_hours", "darkness_hours",
    ]),
    thaena: environment.thaena,
    conversation_recorded: compactConversation(recorded),
  };
  if (scope === "weather") return common;

  const emotionalContract = {
    provenance: emotionalState.provenance ?? [],
    as_of: emotionalState.as_of ?? null,
    uncertainty: "labels_provisional_interpretive_freedom_preserved",
    decay: "immediate_appraisals_event_specific_slow_mood_revisable",
  };
  const summary = {
    ...common,
    instrument_contract: {
      ...common.instrument_contract,
      subjective_override: { operation: "emotional_reflection", actions: ["record_event", "calibrate_cue", "retract_event"] },
      emotional_state: emotionalContract,
      agency: {
        provenance: "aauthora-agency-ledger",
        decay: "explicit_expiry_or_mithra_authored_revision_or_retraction",
        inference: "prohibited",
      },
    },
    estrus: environment.estrus,
    outfit: select(outfit, ["indoor_summary", "outdoor_summary"]),
    possessions: select(possessions, [
      "possession_count", "wearable_count", "pending_gift_reviews",
      "most_recent_gift", "most_recent_refused_offer",
    ]),
    emotional_state: compactEmotion(emotionalState),
    agency: selectPresent(agency, [
      "schema_version", "revision", "active_count", "scopes", "repair_pending",
      "explicit_only", "inference_prohibited", "prior_closeness_creates_permission",
    ]),
    previous_conversation: previous,
  };
  if (scope === "summary") return summary;

  return {
    ...summary,
    scope: "full",
    outfit: select(outfit, ["indoor_summary", "outdoor_summary", "indoor_items", "outdoor_additions"]),
    possessions: current.possessions,
    emotional_state: current.emotional_state,
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

function compactConversation(value: JsonObject): JsonObject {
  return selectPresent(value, [
    "recorded", "last_conversation_at", "last_conversation_earth_date",
    "earth_days_since_last_conversation", "aauthoran_days_since_last_conversation",
  ]);
}

function compactEmotion(value: JsonObject): JsonObject {
  const mood = objectValue(value.mood);
  const immediate = objectValue(value.immediate_context);
  const bodily = objectValue(value.bodily_context);
  const activeAppraisals = Array.isArray(immediate.active_appraisals) ? immediate.active_appraisals.length : 0;
  return {
    ...selectPresent(value, [
      "as_of", "revision", "valence", "arousal", "connection", "energy",
      "tentative_labels", "named_emotion_assigned", "interpretive_freedom_preserved",
      "labels_are_provisional", "uncertainty_preserved", "estrus_phase",
      "automatic_feedback_prohibited", "estrus_affects_consent_or_judgment",
      "cues_are_influences_not_instructions", "relationship_change_requires_evidence",
    ]),
    mood: selectPresent(mood, ["valence", "arousal", "connection", "energy", "source", "timescale"]),
    immediate_context: {
      ...selectPresent(immediate, ["valence", "arousal", "connection", "energy", "timescale"]),
      active_appraisal_count: activeAppraisals,
    },
    bodily_context: selectPresent(bodily, ["signals", "influence", "interpreted_as_named_emotion"]),
  };
}

function selectPresent(value: JsonObject, keys: string[]): JsonObject {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function select(value: JsonObject, keys: string[]): JsonObject {
  return Object.fromEntries(keys.map((key) => [key, value[key] ?? null]));
}
