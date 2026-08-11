import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Config } from "../src/config.js";
import { openDb, type ShardDatabase } from "../src/db.js";
import { seedShardDatabase } from "../src/seed.js";
import { buildServer } from "../src/server.js";

const config: Config = {
  port: 0, bind: "127.0.0.1", dbPath: ":memory:", retrievalApiUrl: "http://127.0.0.1:1",
};

const syntheticSeed = {
  inhabitants: [{
    slug: "example", name: "Example", role: "tester", species: "synthetic", home: "fixture",
    craft: "verification", personality: "deterministic", background: "Synthetic test data only.",
  }],
  routines: [{ inhabitant_id: "example", window_start: 0, window_end: 35.9, location: "fixture", activity: "being tested" }],
  persons: [
    { id: "example", name: "Example", kind: "inhabitant" },
    { id: "other", name: "Other", kind: "visitor" },
  ],
  bonds: [{ holder_id: "example", other_id: "other", role: "test peer" }],
  bond_entries: [{ holder_id: "example", other_id: "other", kind: "check", text: "Synthetic entry.", written_by: "example" }],
  events: [{ inhabitant_id: "example", kind: "fixture", text: "Synthetic event." }],
};

describe("Shard-Lantern portable service", () => {
  let database: ShardDatabase;
  let app: FastifyInstance;

  beforeAll(() => {
    database = openDb(":memory:");
    expect(seedShardDatabase(database, syntheticSeed)).toBe(true);
    expect(seedShardDatabase(database, syntheticSeed)).toBe(false);
    app = buildServer(config, database);
  });
  afterAll(async () => { await app.close(); database.close(); });

  it("serves a synthetic inhabitant and deterministic pulse", async () => {
    const inhabitant = await app.inject({ method: "GET", url: "/api/v1/inhabitants/example" });
    expect(inhabitant.statusCode).toBe(200);
    expect(inhabitant.json()).toMatchObject({ inhabitant: { name: "Example" } });
    const pulse = await app.inject({ method: "GET", url: "/api/v1/pulse?hour=12" });
    expect(pulse.json()).toMatchObject({ status: "ok", inhabitants: [{ slug: "example", activity: "being tested" }] });
  });

  it("records events and body-scoped bond history", async () => {
    const event = await app.inject({ method: "POST", url: "/api/v1/events", payload: {
      inhabitant_id: "example", kind: "fixture", text: "Another synthetic event.",
    } });
    expect(event.statusCode).toBe(201);
    const bond = await app.inject({ method: "GET", url: "/api/v1/bonds/example/other" });
    expect(bond.json()).toMatchObject({ bond: { role: "test peer" }, entries: [{ written_by: "example" }] });
  });
});
