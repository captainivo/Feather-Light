import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openReadonly } from "../src/db.js";
import { latestEnvironmentDay } from "../src/readers/environment.js";
import { growthSummary, longingSummary } from "../src/readers/shelves.js";
import { activeDirectivesByKind, openHandRepairs } from "../src/readers/agency.js";

const config = loadConfig();
const database = openReadonly(config.featherLightDb);

describe("state readers against the live database", () => {
  it("reads the latest environment day", () => {
    const day = latestEnvironmentDay(database);
    expect(day).not.toBeNull();
    expect(typeof day!.season.name).toBe("string");
    expect(typeof day!.weather.temperature_current_c).toBe("number");
  });

  it("summarizes growth and longing", () => {
    const growth = growthSummary(database);
    expect(growth.active).toBeGreaterThanOrEqual(0);
    expect(typeof growth.byKind).toBe("object");
    const longing = longingSummary(database);
    expect(longing.privateHeld + longing.sharedHeld + longing.released).toBeGreaterThanOrEqual(0);
  });

  it("summarizes directives and repairs", () => {
    const directives = activeDirectivesByKind(database);
    expect(directives.active).toBeGreaterThanOrEqual(0);
    const repairs = openHandRepairs(database);
    expect(repairs.pending + repairs.applied).toBeGreaterThanOrEqual(0);
  });
});

