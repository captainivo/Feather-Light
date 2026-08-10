import { afterEach, describe, expect, it } from "vitest";
import { archiveDevelopmentReport, recordArchiveNoteEvent } from "../src/archive-ledger.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import { parseArchiveSubmission } from "../src/story-archive-contract.js";
import { recordArchiveSubmission } from "../src/archive-transactions.js";

const databases: FeatherDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture(): { database: FeatherDatabase; transactionId: string } {
  const database = openDatabase(":memory:");
  migrate(database);
  databases.push(database);
  const submission = parseArchiveSubmission({ submission_id: "SUB-ledger-001", mode: "archive", source_client: "web-ui", submitted_at: "2026-08-05T12:00:00Z", content: "Synthetic source", requested_status: "draft", categories: ["character"] });
  return { database, transactionId: recordArchiveSubmission(database, submission).transaction.transactionId };
}

function event(transactionId: string) {
  return {
    transactionId, noteId: "person-example-001", filePath: "Characters/Example.md", title: "Example", type: "person", status: "draft",
    occurredAt: "2026-08-05T12:05:00Z", action: "NEW", wordsBefore: 0, wordsAfter: 120,
    wordsAdded: 120, wordsRemoved: 0, linksAdded: 3, linksRemoved: 0, sourceHash: "a".repeat(64),
    actor: "web-ui", primaryCategory: "character", secondaryCategories: ["third-civilization"], metadata: { synthetic: true },
  };
}

describe("archive development ledger", () => {
  it("atomically records a note snapshot, append-only event, and categories", () => {
    const { database, transactionId } = fixture();
    const id = recordArchiveNoteEvent(database, event(transactionId), "ANE-test-001");
    expect(id).toBe("ANE-test-001");
    expect((database.prepare("SELECT count(*) AS count FROM archive_notes").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT count(*) AS count FROM archive_note_events").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT count(*) AS count FROM archive_note_event_categories").get() as { count: number }).count).toBe(2);
  });

  it("reports objective activity metrics for a half-open date range", () => {
    const { database, transactionId } = fixture();
    recordArchiveNoteEvent(database, event(transactionId));
    const report = archiveDevelopmentReport(database, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z");
    expect(report.metrics).toEqual({ events: 1, newNotes: 1, uniqueNotes: 1, activeDays: 1, wordsAdded: 120, wordsRemoved: 0, netWords: 120, grossWordsChanged: 120, linksAdded: 3, linksRemoved: 0 });
    expect(report.categories).toEqual([{ category: "character", events: 1, weightedEvents: 1 }, { category: "third-civilization", events: 1, weightedEvents: 1 }]);
    expect(report.subjects).toEqual([{ noteId: "person-example-001", title: "Example", events: 1 }]);
  });

  it("rejects irreconcilable word metrics without partial writes", () => {
    const { database, transactionId } = fixture();
    expect(() => recordArchiveNoteEvent(database, { ...event(transactionId), wordsAdded: 119 })).toThrow("gross word changes must reconcile");
    expect((database.prepare("SELECT count(*) AS count FROM archive_note_events").get() as { count: number }).count).toBe(0);
  });
});
