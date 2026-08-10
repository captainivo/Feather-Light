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
    expect(status.json()).toMatchObject({ status: "not_indexed", schemaVersion: 18 });

    const toolStatus = await app.inject({
      method: "POST",
      url: "/v1/query",
      payload: { operation: "status" },
    });
    expect(toolStatus.statusCode).toBe(200);
    expect(toolStatus.json()).toMatchObject({ status: "not_indexed", schemaVersion: 18 });

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

  it("validates archive submissions without claiming persistence", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/archive/validate",
      payload: {
        submission_id: "SUB-2026-08-09-004",
        mode: "archive",
        source_client: "n8n",
        submitted_at: "2026-08-09T19:54:00-07:00",
        content: "Angus carried the feather cylinder.",
        requested_status: "canon",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "valid",
      persisted: false,
      submission: {
        submission_id: "SUB-2026-08-09-004",
        mode: "archive",
        source_client: "n8n",
        submitted_at: "2026-08-09T19:54:00-07:00",
        requested_status: "canon",
        primary_subject: null,
        targets: [],
        categories: [],
        metadata: {},
        content_characters: 35,
      },
    });
  });

  it("returns bounded deterministic archive development reports", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/archive/reports/development?from=2026-08-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", report: { metrics: { events: 0, grossWordsChanged: 0 }, actions: [], categories: [], subjects: [] } });
    const invalid = await app.inject({ method: "GET", url: "/v1/archive/reports/development?from=nope&to=also-nope" });
    expect(invalid.statusCode).toBe(400);
  });

  it("exposes guarded archive transaction lifecycle routes", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);
    const created = await app.inject({ method: "POST", url: "/v1/archive/submissions", payload: {
      submission_id: "SUB-lifecycle-001", mode: "archive", source_client: "n8n",
      submitted_at: "2026-08-10T04:00:00Z", content: "Synthetic lifecycle request.", requested_status: "draft",
    } });
    const transactionId = created.json().transaction_id as string;
    const processing = await app.inject({ method: "PATCH", url: `/v1/archive/transactions/${transactionId}`, payload: {
      status: "processing", occurredAt: "2026-08-10T04:01:00Z", summary: "Checks started.",
    } });
    expect(processing.statusCode).toBe(200);
    expect(processing.json()).toMatchObject({ transaction: { status: "processing" } });
    const list = await app.inject({ method: "GET", url: "/v1/archive/transactions?status=processing&limit=1" });
    expect(list.json()).toMatchObject({ status: "ok", transactions: [{ transactionId }] });
    const detail = await app.inject({ method: "GET", url: `/v1/archive/transactions/${transactionId}` });
    expect(detail.json()).toMatchObject({ status: "ok", transaction: { transactionId, status: "processing" } });
    const event = await app.inject({ method: "POST", url: `/v1/archive/transactions/${transactionId}/events`, payload: {
      eventId: "ANE-api-001", noteId: "person-example-001", filePath: "Characters/Example.md", title: "Example",
      type: "person", status: "draft", occurredAt: "2026-08-10T04:02:00Z",
      beforeContent: "Example stood.\n", afterContent: "[[Example]] stood by the tower.\n",
      actor: "n8n", primaryCategory: "character",
    } });
    expect(event.statusCode).toBe(201);
    expect(event.json()).toMatchObject({ status: "recorded", event_id: "ANE-api-001", metrics: { links_added: 1 } });
    const events = await app.inject({ method: "GET", url: `/v1/archive/transactions/${transactionId}/events?limit=1` });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toMatchObject({ status: "ok", events: [{
      eventId: "ANE-api-001", noteId: "person-example-001", categories: [{ name: "character", role: "primary" }],
    }], next_cursor: null });
    expect(JSON.stringify(events.json())).not.toContain("stood by the tower");
  });

  it("atomically claims pending archive work without returning its source body", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);
    await app.inject({ method: "POST", url: "/v1/archive/submissions", payload: {
      submission_id: "SUB-claim-api-001", mode: "archive", source_client: "n8n",
      submitted_at: "2026-08-10T04:00:00Z", content: "Private synthetic claim payload.", requested_status: "draft",
    } });
    const claimed = await app.inject({ method: "POST", url: "/v1/archive/transactions/claim", payload: {
      workerId: "n8n-main", occurredAt: "2026-08-10T04:01:00Z",
    } });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ status: "claimed", transaction: {
      status: "processing", claimedBy: "n8n-main", processingStartedAt: "2026-08-10T04:01:00Z",
    } });
    expect(JSON.stringify(claimed.json())).not.toContain("Private synthetic claim payload");
    const transactionId = claimed.json().transaction.transactionId as string;
    const rejectedWork = await app.inject({ method: "GET", url: `/v1/archive/transactions/${transactionId}/work?worker_id=n8n-other` });
    expect(rejectedWork.statusCode).toBe(409);
    const work = await app.inject({ method: "GET", url: `/v1/archive/transactions/${transactionId}/work?worker_id=n8n-main` });
    expect(work.statusCode).toBe(200);
    expect(work.json()).toMatchObject({ status: "work", request: { submission_id: "SUB-claim-api-001", content: "Private synthetic claim payload." } });
    const empty = await app.inject({ method: "POST", url: "/v1/archive/transactions/claim", payload: {
      workerId: "n8n-main", occurredAt: "2026-08-10T04:02:00Z",
    } });
    expect(empty.statusCode).toBe(204);
  });

  it("rejects invalid and client-specific archive submission fields", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/archive/validate",
      payload: {
        submission_id: "SUB-2026-08-09-005",
        mode: "retcon",
        source_client: "web-ui",
        submitted_at: "2026-08-09T19:54:00-07:00",
        content: "Replace the earlier account.",
        requested_status: "canon",
        n8n_node_id: "must-not-cross-the-boundary",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "invalid_request" });
  });

  it("protects archive validation with the configured bearer token", async () => {
    const tokenPath = `/tmp/feather-light-token-${crypto.randomUUID()}`;
    writeFileSync(tokenPath, "archive-test-token\n", { mode: 0o600 });
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer({ ...config, server: { ...config.server, authTokenFile: tokenPath } }, database);
    resources.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/archive/validate",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    unlinkSync(tokenPath);
  });

  it("persists archive submissions idempotently and rejects conflicting replays", async () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const app = buildServer(config, database);
    resources.push(app);
    const payload = {
      submission_id: "SUB-2026-08-10-API-001",
      mode: "archive",
      source_client: "n8n",
      submitted_at: "2026-08-10T04:00:00Z",
      content: "A durable source submission.",
      requested_status: "draft",
    };
    const first = await app.inject({ method: "POST", url: "/v1/archive/submissions", payload });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({
      status: "accepted",
      persisted: true,
      replayed: false,
      submission_id: payload.submission_id,
      transaction_status: "pending",
    });

    const replay = await app.inject({ method: "POST", url: "/v1/archive/submissions", payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      status: "accepted",
      persisted: true,
      replayed: true,
      transaction_id: first.json().transaction_id as string,
    });

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/archive/submissions",
      payload: { ...payload, content: "Conflicting source material." },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      status: "idempotency_conflict",
      transaction_id: first.json().transaction_id as string,
    });
    expect((database.prepare("SELECT count(*) AS count FROM archive_transactions").get() as { count: number }).count).toBe(1);
  });
});
