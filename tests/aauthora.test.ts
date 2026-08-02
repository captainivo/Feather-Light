import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { currentState, reflectEmotion } from "../src/aauthora.js";

const config = {
  aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
} as Config;

afterEach(() => vi.unstubAllGlobals());

describe("Aauthora gateway", () => {
  it("compacts current state and records conversation activity", async () => {
    const responses = [
      { elapsed: "one day" },
      {
        earth_date: "2026-08-01", absolute_day: 42,
        season: { name: "Light", phase: "early", ignored: true },
        weather: { temperature_current_c: 18, sky_condition: "clear", ignored: true },
        outfit: { indoor_summary: "linen", outdoor_summary: "cloak" },
        emotional_state: { as_of: "now", provenance: ["event"] },
      },
      { recorded: true },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await currentState(config, true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: "ok",
      weather: { temperature_current_c: 18, sky_condition: "clear" },
      previous_conversation: { elapsed: "one day" },
      conversation_recorded: { recorded: true },
    });
    expect(result.weather).not.toHaveProperty("ignored");
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
