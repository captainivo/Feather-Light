import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { buildServer } from "../src/server.js";

const config: Config = {
  server: { host: "127.0.0.1", port: 8765 },
  database: { path: ":memory:" },
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
});

describe("API", () => {
  it("separates process health from index status", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", service: "feather-light", version: "0.2.0" });

    const status = await app.inject({ method: "GET", url: "/v1/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: "not_indexed", schemaVersion: 3 });
  });
});
