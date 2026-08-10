import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openReadonly } from "../src/db.js";
import { buildServer } from "../src/server.js";

const config = loadConfig();
const database = openReadonly(config.featherLightDb);
const app = buildServer(config, database);

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  database.close();
});

describe("river-slate server", () => {
  it("serves /healthz", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", db: "readonly:ok" });
  });

  it("serves /api/v1/state", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/state" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("generated_at");
    expect(body).toHaveProperty("season");
    expect(body).toHaveProperty("weather");
    expect(body.mood).toHaveProperty("valence");
    expect(Array.isArray(body.cues)).toBe(true);
    expect(body.outfit).toHaveProperty("indoor");
  });

  it("serves /api/v1/health", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("as_of");
    expect(Object.keys(body.signs)).toHaveLength(5);
  });

  it("serves /api/v1/shelves", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/shelves" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.growth).toHaveProperty("active");
    expect(body.growth).toHaveProperty("by_kind");
    expect(body.longing).toHaveProperty("private_held");
    expect(body.longing).toHaveProperty("released");
  });

  it("serves /api/v1/agency", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/agency" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.directives).toHaveProperty("active");
    expect(body.open_hand).toHaveProperty("pending");
    expect(body.open_hand).toHaveProperty("applied");
  });
});

