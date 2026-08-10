import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";

const growthKinds = ["courage", "lesson", "insight", "healing", "connection", "other"] as const;

export const growthEntrySchema = z.object({
  entry_id: z.string(),
  kind: z.enum(growthKinds),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8_000),
  tags_json: z.string(),
  status: z.enum(["active", "superseded", "retracted"]),
  created_at: z.string(),
  updated_at: z.string(),
  source_type: z.string(),
  source_id: z.string(),
  idempotency_key: z.string().nullable(),
  supersedes_id: z.string().nullable(),
  revision_note: z.string().nullable(),
  retracted_at: z.string().nullable(),
  retraction_note: z.string().nullable(),
});

export const growthActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("state"),
    view: z.enum(["compact", "full"]).default("compact"),
  }).strict(),
  z.object({
    action: z.literal("add"),
    kind: z.enum(growthKinds),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8_000),
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
    source_type: z.string().min(1).max(100),
    source_id: z.string().min(1).max(500),
    idempotency_key: z.string().min(1).max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("list"),
    kind: z.enum(growthKinds).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }).strict(),
  z.object({
    action: z.literal("get"),
    entry_id: z.string().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal("revise"),
    entry_id: z.string().min(1).max(500),
    kind: z.enum(growthKinds).optional(),
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(8_000).optional(),
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
    note: z.string().max(2_000).optional(),
  }).strict().refine(
    (input) => input.kind !== undefined || input.title !== undefined || input.body !== undefined || input.tags !== undefined,
    { message: "revision requires at least one changed field" },
  ),
  z.object({
    action: z.literal("retract"),
    entry_id: z.string().min(1).max(500),
    note: z.string().max(2_000).optional(),
  }).strict(),
]);

export type GrowthAction = z.input<typeof growthActionSchema>;

const longingVisibilities = ["private", "shared"] as const;
const longingStatuses = ["held", "released", "retracted"] as const;

export const longingEntrySchema = z.object({
  entry_id: z.string(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8_000),
  tags_json: z.string(),
  visibility: z.enum(longingVisibilities),
  status: z.enum(longingStatuses),
  created_at: z.string(),
  updated_at: z.string(),
  source_type: z.string(),
  source_id: z.string(),
  idempotency_key: z.string().nullable(),
  released_at: z.string().nullable(),
  release_note: z.string().nullable(),
  retracted_at: z.string().nullable(),
  retraction_note: z.string().nullable(),
});

export const longingActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("state"),
    view: z.enum(["compact", "full"]).default("compact"),
  }).strict(),
  z.object({
    action: z.literal("add"),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8_000),
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
    visibility: z.enum(longingVisibilities).default("private"),
    source_type: z.string().min(1).max(100),
    source_id: z.string().min(1).max(500),
    idempotency_key: z.string().min(1).max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("list"),
    status: z.enum(longingStatuses).optional(),
    visibility: z.enum(longingVisibilities).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }).strict(),
  z.object({
    action: z.literal("get"),
    entry_id: z.string().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal("share"),
    entry_id: z.string().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal("release"),
    entry_id: z.string().min(1).max(500),
    note: z.string().max(2_000).optional(),
  }).strict(),
  z.object({
    action: z.literal("retract"),
    entry_id: z.string().min(1).max(500),
    note: z.string().max(2_000).optional(),
  }).strict(),
]);

export type LongingAction = z.input<typeof longingActionSchema>;
type Row = Record<string, string | number | null>;

function now(): string {
  return new Date().toISOString();
}

function rowToGrowth(row: Row): z.infer<typeof growthEntrySchema> {
  return {
    entry_id: String(row.entry_id),
    kind: String(row.kind) as z.infer<typeof growthEntrySchema>["kind"],
    title: String(row.title),
    body: String(row.body),
    tags_json: String(row.tags_json),
    status: String(row.status) as z.infer<typeof growthEntrySchema>["status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    source_type: String(row.source_type),
    source_id: String(row.source_id),
    idempotency_key: row.idempotency_key === null ? null : String(row.idempotency_key),
    supersedes_id: row.supersedes_id === null ? null : String(row.supersedes_id),
    revision_note: row.revision_note === null ? null : String(row.revision_note),
    retracted_at: row.retracted_at === null ? null : String(row.retracted_at),
    retraction_note: row.retraction_note === null ? null : String(row.retraction_note),
  };
}

function rowToLonging(row: Row): z.infer<typeof longingEntrySchema> {
  return {
    entry_id: String(row.entry_id),
    title: String(row.title),
    body: String(row.body),
    tags_json: String(row.tags_json),
    visibility: String(row.visibility) as z.infer<typeof longingEntrySchema>["visibility"],
    status: String(row.status) as z.infer<typeof longingEntrySchema>["status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    source_type: String(row.source_type),
    source_id: String(row.source_id),
    idempotency_key: row.idempotency_key === null ? null : String(row.idempotency_key),
    released_at: row.released_at === null ? null : String(row.released_at),
    release_note: row.release_note === null ? null : String(row.release_note),
    retracted_at: row.retracted_at === null ? null : String(row.retracted_at),
    retraction_note: row.retraction_note === null ? null : String(row.retraction_note),
  };
}

function publicGrowth(row: z.infer<typeof growthEntrySchema>) {
  return {
    entry_id: row.entry_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags_json) as string[],
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    supersedes_id: row.supersedes_id,
    revision_note: row.revision_note,
    retracted_at: row.retracted_at,
    retraction_note: row.retraction_note,
  };
}

function publicLonging(row: z.infer<typeof longingEntrySchema>) {
  return {
    entry_id: row.entry_id,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags_json) as string[],
    visibility: row.visibility,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    released_at: row.released_at,
    release_note: row.release_note,
    retracted_at: row.retracted_at,
    retraction_note: row.retraction_note,
  };
}

function growthStateRows(database: FeatherDatabase): Row[] {
  return database.prepare(
    "SELECT * FROM growth_entries WHERE status='active' ORDER BY created_at DESC",
  ).all() as Row[];
}

export function growthState(database: FeatherDatabase, view: "compact" | "full" = "compact") {
  const active = growthStateRows(database);
  const byKind: Record<string, number> = {};
  for (const kind of growthKinds) byKind[kind] = 0;
  for (const row of active) {
    const kind = String(row.kind);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const counts = database.prepare(`
    SELECT
      (SELECT count(*) FROM growth_entries) AS total,
      (SELECT count(*) FROM growth_entries WHERE status='active') AS active,
      (SELECT count(*) FROM growth_entries WHERE status='superseded') AS superseded,
      (SELECT count(*) FROM growth_entries WHERE status='retracted') AS retracted
  `).get() as Row;
  const result: Record<string, unknown> = {
    schema_version: 1,
    ...counts,
    by_kind: byKind,
  };
  if (view === "full") result.entries = active.map((row) => publicGrowth(rowToGrowth(row)));
  return result;
}

function insertGrowth(database: FeatherDatabase, input: Extract<GrowthAction, { action: "add" }>) {
  return database.transaction(() => {
    if (input.idempotency_key) {
      const existing = database.prepare(
        "SELECT * FROM growth_entries WHERE idempotency_key=?",
      ).get(input.idempotency_key) as Row | undefined;
      if (existing) {
        const matches = String(existing.kind) === input.kind
          && String(existing.title) === input.title
          && String(existing.body) === input.body
          && String(existing.tags_json) === JSON.stringify(input.tags ?? [])
          && String(existing.source_type) === input.source_type
          && String(existing.source_id) === input.source_id;
        if (!matches) throw new Error("idempotency key is already bound to a different growth request");
        return { created: false, entry_id: String(existing.entry_id), status: "existing" };
      }
    }
    const entryId = randomUUID();
    const timestamp = now();
    database.prepare(`
      INSERT INTO growth_entries
      (entry_id,kind,title,body,tags_json,status,created_at,updated_at,source_type,source_id,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      entryId, input.kind, input.title, input.body, JSON.stringify(input.tags ?? []),
      "active", timestamp, timestamp, input.source_type, input.source_id,
      input.idempotency_key ?? null,
    );
    return { created: true, entry_id: entryId, status: "active" };
  })();
}

function reviseGrowth(database: FeatherDatabase, input: Extract<GrowthAction, { action: "revise" }>) {
  return database.transaction(() => {
    const prior = database.prepare("SELECT * FROM growth_entries WHERE entry_id=?").get(input.entry_id) as Row | undefined;
    if (!prior) throw new Error("growth entry not found");
    if (String(prior.status) !== "active") throw new Error("only an active growth entry can be revised");
    const nextKind = input.kind ?? String(prior.kind);
    const nextTitle = input.title ?? String(prior.title);
    const nextBody = input.body ?? String(prior.body);
    const priorTags = JSON.parse(String(prior.tags_json)) as string[];
    const nextTags = input.tags ?? priorTags;
    database.prepare("UPDATE growth_entries SET status='superseded',updated_at=? WHERE entry_id=?").run(now(), input.entry_id);
    const entryId = randomUUID();
    const timestamp = now();
    database.prepare(`
      INSERT INTO growth_entries
      (entry_id,kind,title,body,tags_json,status,created_at,updated_at,source_type,source_id,idempotency_key,supersedes_id,revision_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?)
    `).run(
      entryId, nextKind, nextTitle, nextBody, JSON.stringify(nextTags),
      "active", timestamp, timestamp, String(prior.source_type), String(prior.source_id), input.entry_id, input.note ?? null,
    );
    return { revised: true, entry_id: entryId, supersedes_id: input.entry_id, status: "active" };
  })();
}

function retractGrowth(database: FeatherDatabase, input: Extract<GrowthAction, { action: "retract" }>) {
  return database.transaction(() => {
    const prior = database.prepare("SELECT status FROM growth_entries WHERE entry_id=?").get(input.entry_id) as
      | { status: string }
      | undefined;
    if (!prior) throw new Error("growth entry not found");
    if (prior.status !== "active") {
      return { retracted: false, entry_id: input.entry_id, status: prior.status };
    }
    database.prepare(
      "UPDATE growth_entries SET status='retracted',retracted_at=?,retraction_note=?,updated_at=? WHERE entry_id=?",
    ).run(now(), input.note ?? "", now(), input.entry_id);
    return { retracted: true, entry_id: input.entry_id, status: "retracted" };
  })();
}

export function operateGrowth(database: FeatherDatabase, input: GrowthAction) {
  if (input.action === "state") return growthState(database, input.view ?? "compact");
  if (input.action === "add") return insertGrowth(database, input);
  if (input.action === "list") {
    const rows = (input.kind
      ? database.prepare(
        "SELECT * FROM growth_entries WHERE status='active' AND kind=? ORDER BY created_at DESC LIMIT ?",
      ).all(input.kind, input.limit ?? 25)
      : database.prepare(
        "SELECT * FROM growth_entries WHERE status='active' ORDER BY created_at DESC LIMIT ?",
      ).all(input.limit ?? 25)) as Row[];
    return { status: "ok", entries: rows.map((row) => publicGrowth(rowToGrowth(row))), total: rows.length };
  }
  if (input.action === "get") {
    const row = database.prepare("SELECT * FROM growth_entries WHERE entry_id=?").get(input.entry_id) as Row | undefined;
    if (!row) return { status: "not_found", entry_id: input.entry_id };
    return { status: "ok", entry: publicGrowth(rowToGrowth(row)) };
  }
  if (input.action === "revise") return reviseGrowth(database, input);
  return retractGrowth(database, input);
}

function insertLonging(database: FeatherDatabase, input: Extract<LongingAction, { action: "add" }>) {
  return database.transaction(() => {
    if (input.idempotency_key) {
      const existing = database.prepare(
        "SELECT * FROM longing_entries WHERE idempotency_key=?",
      ).get(input.idempotency_key) as Row | undefined;
      if (existing) {
        const matches = String(existing.title) === input.title
          && String(existing.body) === input.body
          && String(existing.tags_json) === JSON.stringify(input.tags ?? [])
          && String(existing.visibility) === (input.visibility ?? "private")
          && String(existing.source_type) === input.source_type
          && String(existing.source_id) === input.source_id;
        if (!matches) throw new Error("idempotency key is already bound to a different longing request");
        return { created: false, entry_id: String(existing.entry_id), status: "existing" };
      }
    }
    const entryId = randomUUID();
    const timestamp = now();
    database.prepare(`
      INSERT INTO longing_entries
      (entry_id,title,body,tags_json,visibility,status,created_at,updated_at,source_type,source_id,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      entryId, input.title, input.body, JSON.stringify(input.tags ?? []),
      input.visibility ?? "private", "held", timestamp, timestamp, input.source_type, input.source_id,
      input.idempotency_key ?? null,
    );
    return { created: true, entry_id: entryId, status: "held", visibility: input.visibility ?? "private" };
  })();
}

function transitionLonging(
  database: FeatherDatabase,
  entryId: string,
  next: "released" | "retracted" | "shared",
  note?: string,
) {
  return database.transaction(() => {
    const prior = database.prepare("SELECT * FROM longing_entries WHERE entry_id=?").get(entryId) as Row | undefined;
    if (!prior) throw new Error("longing entry not found");
    const timestamp = now();
    if (next === "shared") {
      if (String(prior.status) === "retracted") return { changed: false, entry_id: entryId, status: String(prior.status) };
      database.prepare("UPDATE longing_entries SET visibility='shared',updated_at=? WHERE entry_id=?").run(timestamp, entryId);
      return { changed: true, entry_id: entryId, status: String(prior.status), visibility: "shared" };
    }
    if (next === "released") {
      if (String(prior.status) !== "held") return { changed: false, entry_id: entryId, status: String(prior.status) };
      database.prepare(
        "UPDATE longing_entries SET status='released',released_at=?,release_note=?,updated_at=? WHERE entry_id=?",
      ).run(timestamp, note ?? "", timestamp, entryId);
      return { changed: true, entry_id: entryId, status: "released" };
    }
    if (String(prior.status) !== "held") return { changed: false, entry_id: entryId, status: String(prior.status) };
    database.prepare(
      "UPDATE longing_entries SET status='retracted',retracted_at=?,retraction_note=?,updated_at=? WHERE entry_id=?",
    ).run(timestamp, note ?? "", timestamp, entryId);
    return { changed: true, entry_id: entryId, status: "retracted" };
  })();
}

export function longingState(database: FeatherDatabase, view: "compact" | "full" = "compact") {
  const counts = database.prepare(`
    SELECT
      (SELECT count(*) FROM longing_entries) AS total,
      (SELECT count(*) FROM longing_entries WHERE status='held') AS held,
      (SELECT count(*) FROM longing_entries WHERE status='released') AS released,
      (SELECT count(*) FROM longing_entries WHERE status='retracted') AS retracted,
      (SELECT count(*) FROM longing_entries WHERE visibility='private') AS private,
      (SELECT count(*) FROM longing_entries WHERE visibility='shared') AS shared
  `).get() as Row;
  const result: Record<string, unknown> = {
    schema_version: 1,
    ...counts,
  };
  if (view === "full") {
    const rows = database.prepare(
      "SELECT * FROM longing_entries ORDER BY created_at DESC",
    ).all() as Row[];
    result.entries = rows.map((row) => publicLonging(rowToLonging(row)));
  }
  return result;
}

export function operateLonging(database: FeatherDatabase, input: LongingAction) {
  if (input.action === "state") return longingState(database, input.view ?? "compact");
  if (input.action === "add") return insertLonging(database, input);
  if (input.action === "list") {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (input.status) {
      conditions.push("status=?");
      params.push(input.status);
    }
    if (input.visibility) {
      conditions.push("visibility=?");
      params.push(input.visibility);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = database.prepare(
      `SELECT * FROM longing_entries ${where} ORDER BY created_at DESC LIMIT ?`,
    ).all(...params, input.limit ?? 25) as Row[];
    return { status: "ok", entries: rows.map((row) => publicLonging(rowToLonging(row))), total: rows.length };
  }
  if (input.action === "get") {
    const row = database.prepare("SELECT * FROM longing_entries WHERE entry_id=?").get(input.entry_id) as Row | undefined;
    if (!row) return { status: "not_found", entry_id: input.entry_id };
    return { status: "ok", entry: publicLonging(rowToLonging(row)) };
  }
  if (input.action === "share") return transitionLonging(database, input.entry_id, "shared");
  if (input.action === "release") return transitionLonging(database, input.entry_id, "released", input.note);
  return transitionLonging(database, input.entry_id, "retracted", input.note);
}
