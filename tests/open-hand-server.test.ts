import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { operateAgency } from "../src/agency.js";
import { buildServer } from "../src/server.js";

const config: Config = {
  server: { host: "127.0.0.1", port: 8765 }, database: { path: ":memory:" },
  aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
  environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
  archiveRoots: [], limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
};
const resources: Array<ReturnType<typeof buildServer>> = [];
afterEach(async () => { await Promise.all(resources.splice(0).map((app) => app.close())); });

describe("Open Hand enforcement API", () => {
  it("returns the TypeScript block decision through the typed boundary", async () => {
    const database = openDatabase(":memory:"); migrate(database);
    operateAgency(database, { action: "set", kind: "pause", scope_type: "tool_action", scope_value: "tool:terminal", source_type: "verification", source_id: "server-test" });
    const app = buildServer(config, database); resources.push(app);
    const response = await app.inject({ method: "POST", url: "/v1/query", payload: { operation: "agency_enforce", enforcement: { tool_name: "terminal", args: {} } } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", result: { blocked: true, matched_path: "tool:terminal" } });
  });

  it("rejects arbitrary nested tool payloads", async () => {
    const database = openDatabase(":memory:"); migrate(database);
    const app = buildServer(config, database); resources.push(app);
    const response = await app.inject({ method: "POST", url: "/v1/query", payload: { operation: "agency_enforce", enforcement: { tool_name: "terminal", args: { nested: { secret: "not accepted" } } } } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "invalid_request" });
  });
});
