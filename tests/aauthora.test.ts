import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { currentState, reflectEmotion } from "../src/aauthora.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import { importLegacyEnvironment } from "../src/environment.js";

const config = {
  aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
  environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
} as Config;

const databases: FeatherDatabase[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
});

function databaseWithEnvironment(value: object): FeatherDatabase {
  const database = openDatabase(":memory:");
  migrate(database);
  importLegacyEnvironment(database, value as Record<string, unknown>);
  databases.push(database);
  return database;
}

function responseQueue(values: object[]) {
  const remaining = [...values];
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(remaining.shift()), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Aauthora gateway", () => {
  it("defaults to a compact summary and records conversation activity", async () => {
    const environment = {
      earth_date: "2026-08-02", absolute_day: 43,
      season: { name: "Light", phase: "early", ignored: true },
      weather: { total_day_length_hours: 30, daylight_hours: 26, temperature_current_c: 18, sky_condition: "clear", ignored: true },
      thaena: { visible: false }, estrus: { status: "unlikely" },
    };
    const database = databaseWithEnvironment(environment);
    const fetchMock = responseQueue([
      { elapsed: "one day" },
      {
        outfit: {
          indoor_summary: "linen", outdoor_summary: "cloak",
          indoor_items: [{ name: "large payload" }],
        },
        possessions: { possession_count: 2, private_detail: "omit" },
        emotional_state: {
          as_of: "now", provenance: ["event"], valence: 0.2,
          mood: { valence: 0.1, source: "experience" },
          persistent_reflections: [{ note: "large payload" }],
        },
        agency: {
          schema_version: 1, revision: 0, active_count: 0, scopes: [], repair_pending: false,
          explicit_only: true, inference_prohibited: true, prior_closeness_creates_permission: false,
        },
      },
      { recorded: true, conversation_id: "omit" },
    ]);

    const result = await currentState(config, database, true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: "ok",
      scope: "summary",
      weather: { temperature_current_c: 18, sky_condition: "clear" },
      outfit: { indoor_summary: "linen", outdoor_summary: "cloak" },
      emotional_state: { as_of: "now", valence: 0.2, mood: { valence: 0.1 } },
      agency: { active_count: 0, inference_prohibited: true, prior_closeness_creates_permission: false },
      previous_conversation: { elapsed: "one day" },
      conversation_recorded: { recorded: true },
    });
    expect(result.weather).not.toHaveProperty("ignored");
    expect(result.outfit).not.toHaveProperty("indoor_items");
    expect(result.emotional_state).not.toHaveProperty("persistent_reflections");
    expect(result.possessions).not.toHaveProperty("private_detail");
  });

  it("returns a weather-only snapshot without fetching prior-conversation status", async () => {
    const database = databaseWithEnvironment({
      earth_date: "2026-08-02", absolute_day: 43,
      season: { name: "Dark", phase: "deep" },
      weather: { total_day_length_hours: 35.5, daylight_hours: 1.1, temperature_current_c: -57.5, sky_condition: "mostly_cloudy" },
      thaena: { visible: false }, estrus: { status: "unlikely" },
    });
    const fetchMock = responseQueue([
      { recorded: true },
    ]);

    const result = await currentState(config, database, true, "weather");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "ok",
      scope: "weather",
      weather: { temperature_current_c: -57.5, sky_condition: "mostly_cloudy" },
      thaena: { visible: false },
      conversation_recorded: { recorded: true },
    });
    expect(result).not.toHaveProperty("emotional_state");
    expect(result).not.toHaveProperty("outfit");
    expect(result).not.toHaveProperty("possessions");
    expect(result).not.toHaveProperty("previous_conversation");
  });

  it("preserves complete state only when full scope is explicit", async () => {
    const reflection = { event_id: "evt-1", note: "audit detail" };
    const item = { name: "coat" };
    const database = databaseWithEnvironment({
      earth_date: "2026-08-02", absolute_day: 43, season: {},
      weather: { total_day_length_hours: 35.5, daylight_hours: 1.1 }, thaena: {}, estrus: {},
    });
    responseQueue([
      { elapsed: "one day" },
      {
        outfit: { indoor_items: [item], outdoor_additions: [] },
        possessions: { possession_count: 1, records: ["audit"] },
        emotional_state: { persistent_reflections: [reflection] },
      },
      { recorded: true, conversation_id: "full-detail" },
    ]);

    const result = await currentState(config, database, true, "full");
    expect(result).toMatchObject({
      scope: "full",
      outfit: { indoor_items: [item] },
      possessions: { records: ["audit"] },
      emotional_state: { persistent_reflections: [reflection] },
      conversation_recorded: { conversation_id: "full-detail" },
    });
  });

  it("routes deliberate emotional reflections to the matching endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "evt-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await reflectEmotion(config, {
      action: "record_event",
      event_type: "reflection",
      source_type: "conversation",
      source_id: "turn-1",
      note: "Chosen appraisal",
    });
    expect(result).toEqual({ event_id: "evt-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8421/api/v1/emotional-state/events",
      expect.objectContaining({ method: "POST" }),
    );
  });

});
