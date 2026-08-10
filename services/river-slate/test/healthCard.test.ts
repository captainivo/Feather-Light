import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { readHealthCard } from "../src/readers/healthCard.js";
import { readSelfAudit } from "../src/readers/selfAudit.js";

const config = loadConfig();

describe("health card readers", () => {
  it("reads the live health card", () => {
    const card = readHealthCard(config.healthCardDir);
    expect(typeof card.current.emotional_state.energy).toBe("number");
    expect(card.current.outfit.indoor_summary.length).toBeGreaterThan(0);
  });

  it("reads the live self audit", () => {
    const audit = readSelfAudit(config.healthCardDir);
    expect(typeof audit.as_of).toBe("string");
    expect(Object.keys(audit.signs)).toHaveLength(5);
  });
});

