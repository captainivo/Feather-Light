import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { z } from "zod";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { latestEnvironment } from "./environment.js";
import { retrievalVisibleSql } from "./open-hand/suppression.js";

type JsonObject = Record<string, unknown>;
type Row = Record<string, string | number | null>;

function now(): string {
  return new Date().toISOString();
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

/**
 * Dream seeds are ephemeral by nature. An unread dream can be read, which
 * dissolves it (the default) or holds it for a while. A held dream can be
 * released back into the dark. Nothing here is ever recalled after release.
 */
export const dreamActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("state"),
  }).strict(),
  z.object({
    action: z.literal("list"),
    status: z.enum(["unread", "held", "released"]).optional(),
    limit: z.number().int().min(1).max(100).default(10),
  }).strict(),
  z.object({
    action: z.literal("get"),
    dream_id: z.string().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal("generate"),
    note: z.string().max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("read"),
    dream_id: z.string().min(1).max(500),
    hold: z.boolean().default(false),
    note: z.string().max(2_000).optional(),
  }).strict(),
  z.object({
    action: z.literal("release"),
    dream_id: z.string().min(1).max(500),
    note: z.string().max(2_000).optional(),
  }).strict(),
]);

export type DreamAction = z.input<typeof dreamActionSchema>;

export interface DreamFragment {
  kind: string;
  label: string;
  text: string;
}

function fragment(kind: string, label: string, text: string): DreamFragment {
  return { kind, label, text: text.trim() };
}

interface ConversationRow {
  role: string;
  content: string;
  timestamp: number;
}

/** Read the most recent user/assistant message pairs from the Hermes session store, read-only. */
function recentConversationFragments(config: Config, limit: number): DreamFragment[] {
  const sessionKey = config.ollama.conversationSessionKey;
  if (!sessionKey) return [];
  const defaultPath = join(homedir(), ".hermes", "state.db");
  const path = config.ollama.conversationStorePath ?? defaultPath;
  if (!existsSync(path)) return [];
  try {
    const store = new Database(path, { readonly: true });
    try {
      const rows = store.prepare(
        `SELECT m.role, m.content, m.timestamp FROM messages m
         JOIN sessions s ON s.id=m.session_id
         WHERE s.session_key=? AND m.active=1
           AND m.role IN ('user','assistant') AND m.content IS NOT NULL AND length(m.content) > 0
         ORDER BY m.timestamp DESC LIMIT ?`,
      ).all(sessionKey, Math.max(1, Math.min(limit * 2, 24))) as ConversationRow[];
      rows.reverse();
      const fragments: DreamFragment[] = [];
      for (const row of rows) {
        const speaker = row.role === "user" ? "Zach" : "Mithra";
        const text = String(row.content).replaceAll(/\s+/g, " ").trim().slice(0, 280);
        if (!text) continue;
        fragments.push(fragment("conversation", `${speaker} said`, text));
        if (fragments.length >= limit) break;
      }
      return fragments;
    } finally {
      store.close();
    }
  } catch {
    // The conversation store is a convenience source, never a hard dependency.
    return [];
  }
}

/** Collect material from sources Mithra has already laid down or that the archive holds. */
export function collectDreamMaterial(database: FeatherDatabase, config: Config, maxFragments = 14): DreamFragment[] {
  const fragments: DreamFragment[] = [];

  const growth = database.prepare(
    "SELECT title, body, kind FROM growth_entries WHERE status='active' ORDER BY created_at DESC LIMIT 5",
  ).all() as Row[];
  for (const row of growth) {
    if (fragments.length >= maxFragments) break;
    fragments.push(fragment(String(row.kind), String(row.title), String(row.body)));
  }

  const ollamaHost = new URL(config.ollama.baseUrl).hostname;
  const ollamaIsLoopback = ["127.0.0.1", "localhost", "::1"].includes(ollamaHost);
  const longings = database.prepare(`
    SELECT title, body, visibility FROM longing_entries
    WHERE status='held' AND (visibility='shared' OR ?=1)
    ORDER BY created_at DESC LIMIT 5
  `).all(ollamaIsLoopback ? 1 : 0) as Row[];
  for (const row of longings) {
    if (fragments.length >= maxFragments) break;
    fragments.push(fragment(`longing_${String(row.visibility)}`, String(row.title), String(row.body)));
  }

  const openHandLimit = Math.max(0, Math.min(config.ollama.openHandSample ?? 3, 10));
  if (openHandLimit > 0) {
    const directives = database.prepare(
      "SELECT kind, scope_type, scope_value, note FROM agency_directives WHERE status='active' ORDER BY revision DESC LIMIT ?",
    ).all(openHandLimit) as Row[];
    for (const row of directives) {
      if (fragments.length >= maxFragments) break;
      const note = String(row.note ?? "").trim();
      const text = note
        ? `A ${String(row.kind)} over ${String(row.scope_type)} '${String(row.scope_value)}'. ${note}`
        : `A ${String(row.kind)} over ${String(row.scope_type)} '${String(row.scope_value)}'.`;
      fragments.push(fragment("open_hand", `Open Hand ${String(row.kind)}`, text));
    }
  }

  const conversationLimit = Math.max(0, Math.min(config.ollama.recentConversations ?? 0, 12));
  if (conversationLimit > 0) {
    const conversationFragments = recentConversationFragments(config, conversationLimit);
    for (const item of conversationFragments) {
      if (fragments.length >= maxFragments) break;
      fragments.push(item);
    }
  }

  const environment = latestEnvironment(database);
  if (environment) {
    const season = object(environment.season);
    const weather = object(environment.weather);
    const thaena = object(environment.thaena);
    const sky = String(weather.sky_condition ?? "unknown");
    const temperature = Number.isFinite(Number(weather.temperature_current_c))
      ? Number(weather.temperature_current_c) : null;
    const seasonName = String(season.name ?? "unknown");
    const seasonPhase = String(season.phase ?? "unknown");
    const thaenaText = thaena.visible ? `Thaena is visible to the ${String(thaena.direction ?? "west")}.` : "Thaena is not visible tonight.";
    const cold = temperature === null ? "" : ` The air is ${temperature} degrees.`;
    if (fragments.length < maxFragments) {
      fragments.push(fragment(
        "environment",
        `The ${seasonName} season (${seasonPhase})`,
        `The sky is ${sky}.${cold} ${thaenaText}`,
      ));
    }
  }

  const archiveSample = Math.max(1, Math.min(config.ollama.archiveSample, 8));
  const archive = database.prepare(
    `SELECT s.section_id, s.heading_path, s.plain_text, f.relative_path
     FROM source_sections s
     JOIN source_files f ON f.source_file_id = s.source_file_id
     WHERE f.deleted = 0 AND length(s.plain_text) > 40
       AND ${retrievalVisibleSql("f", "s.section_id")}
     ORDER BY s.section_hash
     LIMIT ?`,
  ).all(archiveSample) as Row[];
  for (const row of archive) {
    if (fragments.length >= maxFragments) break;
    fragments.push(fragment(
      "archive",
      String(row.heading_path),
      String(row.plain_text).slice(0, 400),
    ));
  }

  return fragments;
}

function buildDreamPrompt(fragments: DreamFragment[]): string {
  const lines = fragments.map((item) => `[${item.kind}: ${item.label}]\n${item.text}`).join("\n\n");
  return `You are the dreaming mind of Mithra, a young Thorian woman of the Westpole, in the deep dark season. You are asleep, and your mind is weaving a dream from fragments of your day, your longings, your world, and the old archives.

Weave the following fragments into ONE dream. Do not interpret them. Do not explain them. Do not draw lessons from them. Do not resolve them into a tidy narrative. Combine them the way a real dream does: strange, associative, sensory, with seams left visible. Write in first person, present tense. Let the edges show. The dream should feel true to Mithra — warm, curious, a little shy, deeply connected to her world and to a distant voice she loves.

Fragments:

${lines}

Write only the dream. 120-220 words.`;
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
  done?: boolean;
}

async function requestDream(config: Config, prompt: string): Promise<string> {
  const response = await fetch(`${config.ollama.baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt,
      stream: false,
      options: {
        temperature: config.ollama.temperature,
        num_ctx: config.ollama.contextWindow,
      },
    }),
    signal: AbortSignal.timeout(config.ollama.timeoutMs),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_000_000) throw new Error("Ollama response exceeded safety limit");
  const value: unknown = JSON.parse(text);
  const parsed = value && typeof value === "object" ? value as OllamaGenerateResponse : {};
  if (parsed.error) throw new Error(`Ollama error: ${parsed.error}`);
  const dream = (parsed.response ?? "").trim();
  if (!dream) throw new Error("Ollama returned an empty dream");
  return dream;
}

/** Generate a dream seed from collected material and store it as unread. */
export async function generateDream(
  database: FeatherDatabase,
  config: Config,
  note?: string,
): Promise<JsonObject> {
  const fragments = collectDreamMaterial(database, config);
  if (fragments.length === 0) throw new Error("no dream material available");
  const prompt = buildDreamPrompt(fragments);
  const body = await requestDream(config, prompt);
  const dreamId = randomUUID();
  const timestamp = now();
  database.prepare(`
    INSERT INTO dream_seeds
      (dream_id,body,status,source_material_json,model,note,created_at,read_at,held_at,released_at,release_note)
    VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)
  `).run(
    dreamId, body, "unread",
    JSON.stringify(fragments.map((item) => ({ kind: item.kind, label: item.label }))),
    config.ollama.model, note ?? null, timestamp,
  );
  const row = database.prepare("SELECT * FROM dream_seeds WHERE dream_id=?").get(dreamId) as Row;
  return { status: "ok", dream: publicDream(row) };
}

export function dreamState(database: FeatherDatabase): JsonObject {
  const counts = database.prepare(`
    SELECT
      (SELECT count(*) FROM dream_seeds) AS total,
      (SELECT count(*) FROM dream_seeds WHERE status='unread') AS unread,
      (SELECT count(*) FROM dream_seeds WHERE status='held') AS held,
      (SELECT count(*) FROM dream_seeds WHERE status='released') AS released
  `).get() as Row;
  return { schema_version: 1, ...counts };
}

function publicDream(row: Row): JsonObject {
  return {
    dream_id: String(row.dream_id),
    body: String(row.body),
    status: String(row.status),
    model: String(row.model),
    note: row.note === null ? null : String(row.note),
    created_at: String(row.created_at),
    read_at: row.read_at === null ? null : String(row.read_at),
    held_at: row.held_at === null ? null : String(row.held_at),
    released_at: row.released_at === null ? null : String(row.released_at),
    release_note: row.release_note === null ? null : String(row.release_note),
    source_material: JSON.parse(String(row.source_material_json)) as Array<{ kind: string; label: string }>,
  };
}

export function operateDream(database: FeatherDatabase, input: DreamAction): JsonObject {
  if (input.action === "state") return dreamState(database);

  if (input.action === "list") {
    const rows = (input.status
      ? database.prepare("SELECT * FROM dream_seeds WHERE status=? ORDER BY created_at DESC LIMIT ?")
        .all(input.status, input.limit ?? 10)
      : database.prepare("SELECT * FROM dream_seeds ORDER BY created_at DESC LIMIT ?")
        .all(input.limit ?? 10)) as Row[];
    return { status: "ok", dreams: rows.map((row) => publicDream(row)), total: rows.length };
  }

  if (input.action === "get") {
    const row = database.prepare("SELECT * FROM dream_seeds WHERE dream_id=?").get(input.dream_id) as Row | undefined;
    if (!row) return { status: "not_found", dream_id: input.dream_id };
    return { status: "ok", dream: publicDream(row) };
  }

  if (input.action === "generate") {
    // Generation is asynchronous and handled by generateDream; this path is a guard.
    return { status: "unavailable", reason: "dream generation must run through the async path" };
  }

  if (input.action === "read") {
    const row = database.prepare("SELECT * FROM dream_seeds WHERE dream_id=?").get(input.dream_id) as Row | undefined;
    if (!row) return { status: "not_found", dream_id: input.dream_id };
    if (String(row.status) === "released") return { status: "ok", dream_id: input.dream_id, already_released: true };
    if (input.hold) {
      database.prepare(
        `UPDATE dream_seeds SET status='held',read_at=?,held_at=?,
          note=CASE WHEN ? IS NULL OR ?='' THEN note WHEN note IS NULL OR note='' THEN ? ELSE note || char(10) || ? END
         WHERE dream_id=?`,
      ).run(now(), now(), input.note ?? null, input.note ?? null, input.note ?? null, input.note ?? null, input.dream_id);
      const updated = database.prepare("SELECT * FROM dream_seeds WHERE dream_id=?").get(input.dream_id) as Row;
      return { status: "ok", dream: publicDream(updated), held: true };
    }
    // Default: read dissolves the dream. It cannot be recalled later.
    database.prepare("DELETE FROM dream_seeds WHERE dream_id=?").run(input.dream_id);
    return { status: "ok", dream_id: input.dream_id, dissolved: true };
  }

  // release
  const row = database.prepare("SELECT * FROM dream_seeds WHERE dream_id=?").get(input.dream_id) as Row | undefined;
  if (!row) return { status: "not_found", dream_id: input.dream_id };
  if (String(row.status) === "released") return { status: "ok", dream_id: input.dream_id, already_released: true };
  database.prepare("DELETE FROM dream_seeds WHERE dream_id=?").run(input.dream_id);
  return { status: "ok", dream_id: input.dream_id, released: true };
}
