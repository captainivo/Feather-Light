import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";
import { computeArchiveContentDiff, type ArchiveContentDiff } from "./archive-diff.js";

const label = z.string().trim().min(1).max(120);
export const archiveNoteEventSchema = z.object({
  transactionId: z.string().min(1),
  noteId: z.string().min(1),
  filePath: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  type: label,
  status: label,
  occurredAt: z.iso.datetime({ offset: true }),
  action: z.enum(["NEW", "EXPAND", "REVISE", "RETCON", "REORGANIZE", "LINK"]),
  wordsBefore: z.number().int().nonnegative(),
  wordsAfter: z.number().int().nonnegative(),
  wordsAdded: z.number().int().nonnegative(),
  wordsRemoved: z.number().int().nonnegative(),
  linksAdded: z.number().int().nonnegative(),
  linksRemoved: z.number().int().nonnegative(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  gitCommit: z.string().min(1).nullable().default(null),
  actor: label,
  primaryCategory: label,
  secondaryCategories: z.array(label).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((event, context) => {
  if (event.wordsAfter - event.wordsBefore !== event.wordsAdded - event.wordsRemoved) {
    context.addIssue({ code: "custom", path: ["wordsAdded"], message: "gross word changes must reconcile with before and after counts" });
  }
  if (new Set([event.primaryCategory, ...event.secondaryCategories]).size !== 1 + event.secondaryCategories.length) {
    context.addIssue({ code: "custom", path: ["secondaryCategories"], message: "event categories must be unique" });
  }
});

export type ArchiveNoteEventInput = z.infer<typeof archiveNoteEventSchema>;

export function recordArchiveNoteEvent(database: FeatherDatabase, value: unknown, eventId = `ANE-${randomUUID()}`): string {
  const event = archiveNoteEventSchema.parse(value);
  const eventHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  const existing = database.prepare("SELECT event_hash FROM archive_note_events WHERE event_id = ?").get(eventId) as { event_hash: string } | undefined;
  if (existing) {
    if (existing.event_hash === eventHash) return eventId;
    throw new Error(`archive event ID conflict: ${eventId}`);
  }
  const write = database.transaction(() => {
    const transaction = database.prepare("SELECT status FROM archive_transactions WHERE transaction_id = ?").get(event.transactionId) as { status: string } | undefined;
    if (!transaction) throw new Error(`unknown archive transaction: ${event.transactionId}`);
    if (transaction.status !== "processing") throw new Error(`archive transaction must be processing to record events: ${transaction.status}`);
    database.prepare(`
      INSERT INTO archive_notes(note_id, file_path, title, type, status, created_at, last_edited_at, word_count, content_hash, git_last_commit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        file_path=excluded.file_path, title=excluded.title, type=excluded.type, status=excluded.status,
        last_edited_at=excluded.last_edited_at, word_count=excluded.word_count,
        content_hash=excluded.content_hash, git_last_commit=excluded.git_last_commit
    `).run(event.noteId, event.filePath, event.title, event.type, event.status, event.occurredAt, event.occurredAt, event.wordsAfter, event.sourceHash, event.gitCommit);
    database.prepare(`
      INSERT INTO archive_note_events(
        event_id, note_id, transaction_id, occurred_at, action, title_at_time,
        words_before, words_after, words_added, words_removed, net_words,
        links_added, links_removed, source_hash, git_commit, actor, metadata, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId, event.noteId, event.transactionId, event.occurredAt, event.action, event.title,
      event.wordsBefore, event.wordsAfter, event.wordsAdded, event.wordsRemoved,
      event.wordsAdded - event.wordsRemoved, event.linksAdded, event.linksRemoved,
      event.sourceHash, event.gitCommit, event.actor, JSON.stringify(event.metadata), eventHash,
    );
    const insertCategory = database.prepare("INSERT OR IGNORE INTO archive_categories(name) VALUES (?)");
    const categoryId = database.prepare("SELECT category_id FROM archive_categories WHERE name = ?");
    const linkCategory = database.prepare("INSERT INTO archive_note_event_categories(event_id, category_id, role, weight) VALUES (?, ?, ?, 1.0)");
    for (const [name, role] of [[event.primaryCategory, "primary"], ...event.secondaryCategories.map((name) => [name, "secondary"])] as Array<[string, string]>) {
      insertCategory.run(name);
      const row = categoryId.get(name) as { category_id: number };
      linkCategory.run(eventId, row.category_id, role);
    }
  });
  write();
  return eventId;
}

export const archiveNoteChangeSchema = z.object({
  eventId: z.string().trim().min(1).max(120),
  noteId: z.string().min(1), filePath: z.string().min(1), title: z.string().trim().min(1).max(200),
  type: label, status: label, occurredAt: z.iso.datetime({ offset: true }),
  action: z.enum(["NEW", "EXPAND", "REVISE", "RETCON", "REORGANIZE", "LINK"]).optional(),
  beforeContent: z.string().max(2_000_000), afterContent: z.string().max(2_000_000),
  gitCommit: z.string().min(1).nullable().default(null), actor: label, primaryCategory: label,
  secondaryCategories: z.array(label).default([]), metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export interface RecordArchiveNoteChangeResult { eventId: string; diff: ArchiveContentDiff; }

export function recordArchiveNoteChange(database: FeatherDatabase, transactionId: string, value: unknown): RecordArchiveNoteChangeResult {
  const change = archiveNoteChangeSchema.parse(value);
  const diff = computeArchiveContentDiff(change.beforeContent, change.afterContent);
  const action = change.action ?? diff.suggestedAction;
  if (!action) throw new Error("an explicit action is required when body content is unchanged");
  recordArchiveNoteEvent(database, {
    transactionId, noteId: change.noteId, filePath: change.filePath, title: change.title,
    type: change.type, status: change.status, occurredAt: change.occurredAt, action,
    wordsBefore: diff.wordsBefore, wordsAfter: diff.wordsAfter, wordsAdded: diff.wordsAdded,
    wordsRemoved: diff.wordsRemoved, linksAdded: diff.linksAdded, linksRemoved: diff.linksRemoved,
    sourceHash: diff.targetHash, gitCommit: change.gitCommit, actor: change.actor,
    primaryCategory: change.primaryCategory, secondaryCategories: change.secondaryCategories,
    metadata: { ...change.metadata, source_hash_before: diff.sourceHash, body_hash_before: diff.bodyHashBefore, body_hash_after: diff.bodyHashAfter },
  }, change.eventId);
  return { eventId: change.eventId, diff };
}

export interface ArchiveDevelopmentReport {
  from: string;
  to: string;
  metrics: {
    events: number; newNotes: number; uniqueNotes: number; activeDays: number;
    wordsAdded: number; wordsRemoved: number; netWords: number; grossWordsChanged: number;
    linksAdded: number; linksRemoved: number;
  };
  actions: Array<{ action: string; events: number }>;
  categories: Array<{ category: string; events: number; weightedEvents: number }>;
  subjects: Array<{ noteId: string; title: string; events: number }>;
}

export function archiveDevelopmentReport(database: FeatherDatabase, from: string, to: string): ArchiveDevelopmentReport {
  const range = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).refine((value) => value.from < value.to, { message: "from must precede to" }).parse({ from, to });
  const params = [range.from, range.to];
  const row = database.prepare(`
    SELECT count(*) AS events, count(DISTINCT note_id) AS unique_notes,
      count(DISTINCT substr(occurred_at, 1, 10)) AS active_days,
      coalesce(sum(CASE WHEN action='NEW' THEN 1 ELSE 0 END), 0) AS new_notes,
      coalesce(sum(words_added), 0) AS words_added, coalesce(sum(words_removed), 0) AS words_removed,
      coalesce(sum(net_words), 0) AS net_words,
      coalesce(sum(words_added + words_removed), 0) AS gross_words,
      coalesce(sum(links_added), 0) AS links_added, coalesce(sum(links_removed), 0) AS links_removed
    FROM archive_note_events WHERE occurred_at >= ? AND occurred_at < ?
  `).get(...params) as {
    events: number; unique_notes: number; active_days: number; new_notes: number;
    words_added: number; words_removed: number; net_words: number; gross_words: number;
    links_added: number; links_removed: number;
  };
  const actions = database.prepare(`SELECT action, count(*) AS events FROM archive_note_events WHERE occurred_at >= ? AND occurred_at < ? GROUP BY action ORDER BY events DESC, action`).all(...params) as Array<{ action: string; events: number }>;
  const categories = database.prepare(`
    SELECT c.name AS category, count(*) AS events, sum(ec.weight) AS weightedEvents
    FROM archive_note_event_categories ec JOIN archive_categories c USING(category_id)
    JOIN archive_note_events e USING(event_id)
    WHERE e.occurred_at >= ? AND e.occurred_at < ?
    GROUP BY c.category_id ORDER BY weightedEvents DESC, category
  `).all(...params) as Array<{ category: string; events: number; weightedEvents: number }>;
  const subjects = database.prepare(`
    SELECT e.note_id AS noteId, max(e.title_at_time) AS title, count(*) AS events
    FROM archive_note_events e WHERE e.occurred_at >= ? AND e.occurred_at < ?
    GROUP BY e.note_id ORDER BY events DESC, title LIMIT 20
  `).all(...params) as Array<{ noteId: string; title: string; events: number }>;
  return {
    from: range.from, to: range.to,
    metrics: {
      events: row.events, newNotes: row.new_notes, uniqueNotes: row.unique_notes, activeDays: row.active_days,
      wordsAdded: row.words_added, wordsRemoved: row.words_removed, netWords: row.net_words,
      grossWordsChanged: row.gross_words, linksAdded: row.links_added, linksRemoved: row.links_removed,
    },
    actions, categories, subjects,
  };
}
