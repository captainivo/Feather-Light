import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { buildServer } from "../src/server.js";

const config: Config = {
  server: { host: "127.0.0.1", port: 8765 },
  database: { path: ":memory:" },
  aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
  environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
  archiveRoots: [],
  limits: {
    maxFileBytes: 1_048_576,
    searchResults: 10,
    excerptCharacters: 1_200,
    responseCharacters: 16_000,
  },
};

const resources: Array<ReturnType<typeof buildServer>> = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

describe("API", () => {
  it("separates process health from index status", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", service: "feather-light", version: "0.5.0" });

    const status = await app.inject({ method: "GET", url: "/v1/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: "not_indexed", schemaVersion: 8 });

    const toolStatus = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "status" },
    });
    expect(toolStatus.statusCode).toBe(200);
    expect(toolStatus.json()).toMatchObject({ status: "not_indexed", schemaVersion: 8 });

    const invalid = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "search" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ status: "invalid_request" });
  });

  it("validates and forwards agency state through the typed query boundary", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "agency", agency: { action: "state", view: "compact" } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", result: { active_count: 0 } });
  });
});
