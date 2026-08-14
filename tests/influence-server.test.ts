import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import { buildServer } from "../src/server.js";

const config: Config = {
  server: { host: "127.0.0.1", port: 8765 },
  database: { path: ":memory:" },
  aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b-instruct", temperature: 1.1, contextWindow: 4_096, timeoutMs: 60_000, archiveSample: 3 },
  environment: { timezone: "America/Vancouver", masterSeed: "test-seed", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
  archiveRoots: [],
  limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 32_000 },
};

const apps: Array<ReturnType<typeof buildServer>> = [];
const databases: FeatherDatabase[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
});

function server() {
  const database = openDatabase(":memory:");
  migrate(database);
  databases.push(database);
  const app = buildServer(config, database);
  apps.push(app);
  return { app, database };
}

const growth = {
  action: "add",
  kind: "insight",
  title: "A gated insight",
  body: "Only admitted sources may write this.",
  source_type: "conversation",
  source_id: "turn-server-gate",
};

describe("influence API boundary", () => {
  it("requires source context for network mutations while leaving reads available", async () => {
    const { app } = server();
    const mutation = await app.inject({
      method: "POST", url: "/v1/query", payload: { operation: "growth", growth },
    });
    expect(mutation.statusCode).toBe(400);
    expect(mutation.json()).toEqual({ status: "influence_context_required" });

    const read = await app.inject({
      method: "POST", url: "/v1/query", payload: { operation: "growth", growth: { action: "list" } },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ status: "ok", result: { entries: [] } });
  });

  it("returns review instead of allowing Honcho inference to write growth", async () => {
    const { app, database } = server();
    const response = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: {
        operation: "growth",
        growth,
        influence: { request_id: "honcho-growth", source_class: "honcho_inference", source_ref: "honcho:conclusion-1" },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      status: "influence_review_required",
      influence: { domain: "inner_growth", authority: "propose", decision: "review" },
    });
    expect((database.prepare("SELECT count(*) AS count FROM growth_entries").get() as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT decision FROM influence_decisions WHERE request_id='honcho-growth'").get() as { decision: string }).decision)
      .toBe("review");
  });

  it("admits explicit self-authorship and exposes bounded policy and receipt queries", async () => {
    const { app } = server();
    const response = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: {
        operation: "growth",
        growth,
        influence: { request_id: "mithra-growth", source_class: "mithra_explicit", source_ref: "conversation:turn-server-gate" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", result: { created: true } });

    const policies = await app.inject({ method: "POST", url: "/v1/query", payload: { operation: "influence_policies" } });
    expect(policies.statusCode).toBe(200);
    expect(policies.json().policies).toHaveLength(63);

    const decisions = await app.inject({ method: "POST", url: "/v1/query", payload: { operation: "influence_decisions", limit: 10 } });
    expect(decisions.statusCode).toBe(200);
    expect(decisions.json()).toMatchObject({
      status: "ok",
      decisions: [{ request_id: "mithra-growth", decision: "allow" }],
    });
  });

  it("adopts only the exact payload covered by an existing review receipt", async () => {
    const { app, database } = server();
    const proposal = await app.inject({
      method: "POST", url: "/v1/query", payload: {
        operation: "growth", growth,
        influence: { request_id: "model-proposal", source_class: "model_inference", source_ref: "model:turn-1" },
      },
    });
    expect(proposal.statusCode).toBe(409);
    expect(proposal.json().influence).toMatchObject({
      request_id: "model-proposal", decision: "review", payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const substituted = await app.inject({
      method: "POST", url: "/v1/query", payload: {
        operation: "growth", growth: { ...growth, body: "A substituted body." },
        influence: {
          request_id: "bad-adoption", source_class: "mithra_explicit",
          source_ref: "hermes-session:test", adopts_request_id: "model-proposal",
        },
      },
    });
    expect(substituted.statusCode).toBe(400);
    expect(substituted.json().error).toBe("adoption payload does not match the reviewed proposal");

    const adopted = await app.inject({
      method: "POST", url: "/v1/query", payload: {
        operation: "growth", growth,
        influence: {
          request_id: "good-adoption", source_class: "mithra_explicit",
          source_ref: "hermes-session:test", adopts_request_id: "model-proposal",
        },
      },
    });
    expect(adopted.statusCode).toBe(200);
    expect(adopted.json()).toMatchObject({ status: "ok", result: { created: true } });
    expect(database.prepare(
      "SELECT adopts_request_id FROM influence_decisions WHERE request_id='good-adoption'",
    ).get()).toEqual({ adopts_request_id: "model-proposal" });

    const replay = await app.inject({
      method: "POST", url: "/v1/query", payload: {
        operation: "growth", growth,
        influence: {
          request_id: "good-adoption", source_class: "mithra_explicit",
          source_ref: "hermes-session:test", adopts_request_id: "model-proposal",
        },
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ status: "ok", result: { replayed: true, request_id: "good-adoption" } });
    expect(database.prepare("SELECT count(*) AS count FROM growth_entries").get()).toEqual({ count: 1 });
  });

  it("rolls back an allow receipt when the protected mutation itself fails", async () => {
    const { app, database } = server();
    const response = await app.inject({
      method: "POST", url: "/v1/query", payload: {
        operation: "growth", growth: { action: "retract", entry_id: "missing-entry" },
        influence: { request_id: "failed-write", source_class: "mithra_explicit", source_ref: "hermes-session:test" },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(database.prepare(
      "SELECT count(*) AS count FROM influence_decisions WHERE request_id='failed-write'",
    ).get()).toEqual({ count: 0 });
  });
});
