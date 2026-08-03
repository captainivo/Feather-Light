import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { buildServer } from "../src/server.js";

const config: Config = {
  server: { host: "127.0.0.1", port: 8765 }, database: { path: ":memory:" },
  aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
  environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
  archiveRoots: [], limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
};
const resources: Array<ReturnType<typeof buildServer>> = [];
afterEach(async () => Promise.all(resources.splice(0).map((app) => app.close())));

describe("Open Hand repair API", () => {
  it("reports capabilities and records external plans without claiming application", async () => {
    const database = openDatabase(":memory:"); migrate(database); const app = buildServer(config, database); resources.push(app);
    const capabilities = await app.inject({ method: "POST", url: "/v1/query", payload: { operation: "open_hand_repair", repair: { action: "capabilities" } } });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({ status: "ok", result: { automatic_deletion: false, intent_separation_required: true } });
    const plan = await app.inject({ method: "POST", url: "/v1/query", payload: { operation: "open_hand_repair", repair: {
      action: "plan", intent: "correct_objective_error", storage_system: "hermes_memory",
      selector_type: "record_id", selector_value: "exact-record", correction_text: "Correct fact.",
      source_type: "self", source_id: "server-test",
    } } });
    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toMatchObject({ status: "ok", result: { created: true, repair: { status: "external_required", capabilityMode: "external_adapter" } } });
  });

  it("rejects an apply request whose exact confirmation is absent", async () => {
    const database = openDatabase(":memory:"); migrate(database); const app = buildServer(config, database); resources.push(app);
    const response = await app.inject({ method: "POST", url: "/v1/query", payload: { operation: "open_hand_repair", repair: { action: "apply", repair_id: crypto.randomUUID() } } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "invalid_request" });
  });
});
