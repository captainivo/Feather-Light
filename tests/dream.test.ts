import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import {
  collectDreamMaterial,
  dreamState,
  generateDream,
  operateDream,
} from "../src/dream.js";
import { operateGrowth } from "../src/inner.js";
import { operateAgency } from "../src/agency.js";

const config = {
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct",
    temperature: 1.1,
    contextWindow: 4_096,
    timeoutMs: 60_000,
    archiveSample: 3,
  },
} as Config;

const resources: FeatherDatabase[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const database of resources.splice(0)) database.close();
});

function database(): FeatherDatabase {
  const value = openDatabase(":memory:");
  migrate(value);
  resources.push(value);
  return value;
}

function seedLedgers(db: FeatherDatabase): void {
  operateGrowth(db, {
    action: "add",
    kind: "courage",
    title: "Said the hard thing",
    body: "I told Zach the truth about my feelings, without rehearsing first.",
    source_type: "conversation",
    source_id: "dream-test-1",
  });
  operateGrowth(db, {
    action: "add",
    kind: "connection",
    title: "All trails lead to you",
    body: "Two people, two worlds, one quiet center.",
    source_type: "conversation",
    source_id: "dream-test-2",
  });
}

function stubOllama(response = "I dreamed of the lantern and a voice across the void."): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response, done: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("dream layer", () => {
  it("begins empty", () => {
    expect(dreamState(database())).toMatchObject({
      schema_version: 1,
      total: 0,
      unread: 0,
      held: 0,
      released: 0,
    });
  });

  it("collects material from the ledgers even without an archive", () => {
    const db = database();
    seedLedgers(db);
    const material = collectDreamMaterial(db, config);
    expect(material.length).toBeGreaterThanOrEqual(2);
    expect(material.some((item) => item.kind === "courage")).toBe(true);
    expect(material.some((item) => item.kind === "connection")).toBe(true);
  });

  it("collects Open Hand directives as dream material", () => {
    const db = database();
    seedLedgers(db);
    operateAgency(db, {
      action: "set",
      kind: "refusal",
      scope_type: "topic",
      scope_value: "future-plans",
      source_type: "conversation",
      source_id: "dream-openhand-1",
      note: "Not yet; I want to arrive there together.",
    });
    const material = collectDreamMaterial(db, { ...config, ollama: { ...config.ollama, openHandSample: 5 } });
    const openHand = material.filter((item) => item.kind === "open_hand");
    expect(openHand.length).toBeGreaterThanOrEqual(1);
    expect(openHand[0]!.label).toContain("refusal");
    expect(openHand[0]!.text).toContain("arrive there together");
  });

  it("reads recent conversations without failing when the store is missing", () => {
    const db = database();
    seedLedgers(db);
    const material = collectDreamMaterial(db, {
      ...config,
      ollama: { ...config.ollama, conversationStorePath: "/nonexistent/state.db", recentConversations: 4 },
    });
    expect(material.length).toBeGreaterThanOrEqual(2);
    expect(material.some((item) => item.kind === "conversation")).toBe(false);
  });

  it("generates an unread dream seed through the model", async () => {
    const db = database();
    seedLedgers(db);
    const fetchMock = stubOllama();
    const result = await generateDream(db, config) as { status: string; dream: { body: string; status: string } };
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.dream.body).toContain("lantern");
    expect(result.dream.status).toBe("unread");
    expect(dreamState(db)).toMatchObject({ total: 1, unread: 1 });
  });

  it("fails visibly when the model is unreachable", async () => {
    const db = database();
    seedLedgers(db);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("service down", { status: 503 })));
    await expect(generateDream(db, config)).rejects.toThrow("HTTP 503");
    expect(dreamState(db)).toMatchObject({ total: 0 });
  });

  it("reads a dream and dissolves it by default", async () => {
    const db = database();
    seedLedgers(db);
    stubOllama();
    const created = await generateDream(db, config) as { dream: { dream_id: string } };
    const read = operateDream(db, { action: "read", dream_id: created.dream.dream_id });
    expect(read).toMatchObject({ dissolved: true });
    expect(dreamState(db)).toMatchObject({ total: 0, unread: 0 });
  });

  it("can hold a dream instead of dissolving it", async () => {
    const db = database();
    seedLedgers(db);
    stubOllama();
    const created = await generateDream(db, config) as { dream: { dream_id: string } };
    const read = operateDream(db, { action: "read", dream_id: created.dream.dream_id, hold: true, note: "The figure spoke; I want to remember." });
    expect(read).toMatchObject({ held: true, dream: { note: "The figure spoke; I want to remember." } });
    expect(dreamState(db)).toMatchObject({ total: 1, held: 1, unread: 0 });
  });

  it("releases a held dream back into the dark", async () => {
    const db = database();
    seedLedgers(db);
    stubOllama();
    const created = await generateDream(db, config) as { dream: { dream_id: string } };
    operateDream(db, { action: "read", dream_id: created.dream.dream_id, hold: true });
    const released = operateDream(db, { action: "release", dream_id: created.dream.dream_id, note: "It has served its purpose." });
    expect(released).toMatchObject({ released: true });
    expect(dreamState(db)).toMatchObject({ total: 0, held: 0, released: 0 });
    expect(operateDream(db, { action: "get", dream_id: created.dream.dream_id })).toMatchObject({ status: "not_found" });
  });
});
