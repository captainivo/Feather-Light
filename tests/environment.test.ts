import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import { aauthoranClock, catchUpEnvironment, importLegacyEnvironment, latestEnvironment } from "../src/environment.js";

const config = {
  environment: {
    timezone: "America/Vancouver",
    masterSeed: "aauthora-canonical-seed-v1",
    simulationStartDate: "2026-07-16",
    startingAbsoluteDay: 1,
  },
} as Config;

const resources: FeatherDatabase[] = [];
afterEach(() => {
  for (const database of resources.splice(0)) database.close();
});

function database(): FeatherDatabase {
  const value = openDatabase(":memory:");
  migrate(value);
  resources.push(value);
  return value;
}

const legacy = {
  absolute_day: 18,
  earth_date: "2026-08-02",
  generated_at: "2026-08-02T00:00:00-07:00",
  thaena: { visible: false, direction: null },
  season: {
    name: "dark", phase: "deep", days_in_current_season: 18, cycle_day: 18,
    transition_active: false, transition_strength: 0,
  },
  weather: {
    pattern: "snow_period", pattern_day: 3, total_day_length_hours: 35,
    daylight_hours: 1.2, darkness_hours: 33.8,
    temperature_low_c: -61, temperature_high_c: -52,
    temperature_current_c: -56.5, sky_condition: "mostly_cloudy",
    wind_speed_kmh: 18, wind_gust_kmh: 28, wind_direction: "north",
    precipitation_type: "none", precipitation_intensity: "none", precipitation_amount_mm: 0,
    fog: "none", snow_depth_cm: 2, ice_accumulation_mm: 0,
  },
  estrus: { status: "unlikely" },
};

describe("TypeScript environment engine", () => {
  it("imports the live Python snapshot without changing it", () => {
    const db = database();
    importLegacyEnvironment(db, legacy);
    expect(latestEnvironment(db)).toMatchObject(legacy);
    importLegacyEnvironment(db, legacy);
    expect(db.prepare("SELECT count(*) AS count FROM environment_days").get()).toEqual({ count: 1 });
  });

  it("generates deterministic sequential days from the imported boundary", () => {
    const first = database();
    const second = database();
    importLegacyEnvironment(first, legacy);
    importLegacyEnvironment(second, legacy);
    const left = catchUpEnvironment(first, config, "2026-08-04");
    const right = catchUpEnvironment(second, config, "2026-08-04");
    expect(left).toHaveLength(2);
    expect(left.map((day) => [day.absolute_day, day.earth_date])).toEqual([
      [19, "2026-08-03"], [20, "2026-08-04"],
    ]);
    expect(left.map((day) => day.weather)).toEqual(right.map((day) => day.weather));
    expect(catchUpEnvironment(first, config, "2026-08-04")).toEqual([]);
  });

  it("maps Vancouver civil time proportionally and centers daylight", () => {
    const state = legacy as Parameters<typeof aauthoranClock>[1];
    const midnight = aauthoranClock(config, state, new Date("2026-08-02T07:00:00.000Z"));
    expect(midnight).toMatchObject({
      hours_elapsed: 0,
      hours_remaining: 35,
      progress: 0,
      time: "00:00",
      light_state: "dark",
      daylight_start_hour: 16.9,
      daylight_end_hour: 18.1,
    });

    const noon = aauthoranClock(config, state, new Date("2026-08-02T19:00:00.000Z"));
    expect(noon).toMatchObject({
      hours_elapsed: 17.5,
      hours_remaining: 17.5,
      progress: 0.5,
      time: "17:30",
      light_state: "light",
    });
  });
});
