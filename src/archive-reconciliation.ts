import { basename, extname, isAbsolute } from "node:path";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";
import { sha256 } from "./hash.js";
import { parseMarkdown } from "./markdown.js";

const relativeMarkdownPath = z.string().trim().min(1).max(1_000).superRefine((value, context) => {
  if (isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => part === ".." || part === "")) {
    context.addIssue({ code: "custom", message: "file path must be a normalized relative path" });
  }
  if (extname(value).toLowerCase() !== ".md") context.addIssue({ code: "custom", message: "file path must identify a Markdown file" });
});

export const archiveReconciliationInputSchema = z.object({
  filePath: relativeMarkdownPath,
  content: z.string().max(10_000_000),
}).strict();

export type ArchiveReconciliationKind = "unchanged" | "edited" | "renamed" | "renamed_and_edited" | "new" | "identity_conflict";

export interface ArchiveReconciliationPlan {
  kind: ArchiveReconciliationKind;
  noteId: string;
  filePath: string;
  previousFilePath: string | null;
  title: string;
  previousHash: string | null;
  contentHash: string;
  requiresEvent: boolean;
  blocked: boolean;
}

interface NoteRow { note_id: string; file_path: string; content_hash: string; }

export function planArchiveReconciliation(database: FeatherDatabase, value: unknown): ArchiveReconciliationPlan {
  const input = archiveReconciliationInputSchema.parse(value);
  const parsed = parseMarkdown("reconciliation-preview", basename(input.filePath, extname(input.filePath)), input.content);
  const noteId = typeof parsed.frontmatter.id === "string" ? parsed.frontmatter.id.trim() : "";
  if (!noteId) throw new Error("archive reconciliation requires a permanent frontmatter ID");
  const contentHash = sha256(input.content);
  const byId = database.prepare("SELECT note_id, file_path, content_hash FROM archive_notes WHERE note_id=?").get(noteId) as NoteRow | undefined;
  const byPath = database.prepare("SELECT note_id, file_path, content_hash FROM archive_notes WHERE file_path=?").get(input.filePath) as NoteRow | undefined;
  if (!byId && byPath && byPath.note_id !== noteId) {
    return {
      kind: "identity_conflict", noteId, filePath: input.filePath, previousFilePath: byPath.file_path,
      title: parsed.title, previousHash: byPath.content_hash, contentHash, requiresEvent: false, blocked: true,
    };
  }
  if (!byId) {
    return {
      kind: "new", noteId, filePath: input.filePath, previousFilePath: null, title: parsed.title,
      previousHash: null, contentHash, requiresEvent: true, blocked: false,
    };
  }
  const moved = byId.file_path !== input.filePath;
  const changed = byId.content_hash !== contentHash;
  const kind: ArchiveReconciliationKind = moved
    ? changed ? "renamed_and_edited" : "renamed"
    : changed ? "edited" : "unchanged";
  return {
    kind, noteId, filePath: input.filePath, previousFilePath: byId.file_path, title: parsed.title,
    previousHash: byId.content_hash, contentHash, requiresEvent: moved || changed, blocked: false,
  };
}
