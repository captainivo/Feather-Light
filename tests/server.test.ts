import { afterEach, describe, expect, it, vi } from "vitest";
import { unlinkSync, writeFileSync } from "node:fs";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { buildServer } from "../src/server.js";

const config: Config = {
  server: { host: "127.0.0.1", port: 8765 },
  database: { path: ":memory:" },
  aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b-instruct", temperature: 1.1, contextWindow: 4_096, timeoutMs: 60_000, archiveSample: 3 },
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
  it("leaves health public while requiring a bearer token for data routes", async () => {
    const tokenPath = `/tmp/feather-light-token-${crypto.randomUUID()}`;
    writeFileSync(tokenPath, "secret-test-token\n", { mode: 0o600 });
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer({ ...config, server: { ...config.server, authTokenFile: tokenPath } }, database);
    resources.push(app);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/status" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/status", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/status", headers: { authorization: "Bearer secret-test-token" } })).statusCode).toBe(200);
    unlinkSync(tokenPath);
  });

  it("enforces the configured response character ceiling", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer({ ...config, limits: { ...config.limits, responseCharacters: 40 } }, database);
    resources.push(app);
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ status: "response_limited" });
  });

  it("separates process health from index status", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", service: "feather-light", version: "0.4.0" });

    const status = await app.inject({ method: "GET", url: "/v1/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: "not_indexed", schemaVersion: 14 });

    const toolStatus = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "status" },
    });
    expect(toolStatus.statusCode).toBe(200);
    expect(toolStatus.json()).toMatchObject({ status: "not_indexed", schemaVersion: 14 });

    const invalid = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "search" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ status: "invalid_request" });

    const malformedFts = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "search", query: "." },
    });
    expect(malformedFts.statusCode).toBe(400);
    expect(malformedFts.json()).toMatchObject({ status: "invalid_request" });

    const misspelled = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "current_state", recordConveration: false },
    });
    expect(misspelled.statusCode).toBe(400);
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
