import { afterEach, describe, expect, it } from "vitest";
import { planArchiveReconciliation } from "../src/archive-reconciliation.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import { sha256 } from "../src/hash.js";

const databases: FeatherDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

const original = "---\nid: person-example-001\ntitle: Example\n---\nExample stood.\n";

function fixture(): FeatherDatabase {
  const database = openDatabase(":memory:");
  migrate(database);
  databases.push(database);
  database.prepare(`INSERT INTO archive_notes(
    note_id, file_path, title, type, status, created_at, last_edited_at, word_count, content_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "person-example-001", "Characters/Example.md", "Example", "person", "draft",
    "2026-08-10T04:00:00Z", "2026-08-10T04:00:00Z", 2, sha256(original),
  );
  return database;
}

describe("archive external-edit reconciliation planning", () => {
  it("ignores a timestamp-only touch when content and path are unchanged", () => {
    expect(planArchiveReconciliation(fixture(), { filePath: "Characters/Example.md", content: original }))
      .toMatchObject({ kind: "unchanged", noteId: "person-example-001", requiresEvent: false, blocked: false });
  });

  it("recognizes a rename by permanent ID without creating a new entity", () => {
    expect(planArchiveReconciliation(fixture(), { filePath: "People/Example Renamed.md", content: original }))
      .toMatchObject({ kind: "renamed", noteId: "person-example-001", previousFilePath: "Characters/Example.md", requiresEvent: true });
  });

  it("distinguishes edits, new notes, and path identity conflicts", () => {
    const database = fixture();
    const edited = original.replace("stood", "waited");
    expect(planArchiveReconciliation(database, { filePath: "Characters/Example.md", content: edited })).toMatchObject({ kind: "edited" });
    const fresh = "---\nid: place-new-001\ntitle: New Place\n---\nA new place.\n";
    expect(planArchiveReconciliation(database, { filePath: "Places/New Place.md", content: fresh })).toMatchObject({ kind: "new", previousHash: null });
    expect(planArchiveReconciliation(database, { filePath: "Characters/Example.md", content: fresh })).toMatchObject({ kind: "identity_conflict", blocked: true });
  });

  it("rejects files without permanent IDs and unsafe paths", () => {
    const database = fixture();
    expect(() => planArchiveReconciliation(database, { filePath: "Characters/No ID.md", content: "No frontmatter." })).toThrow("permanent frontmatter ID");
    expect(() => planArchiveReconciliation(database, { filePath: "../escape.md", content: original })).toThrow("normalized relative path");
  });
});
