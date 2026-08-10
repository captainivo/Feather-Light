import { closeSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, relative } from "node:path";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import { sha256, stableId } from "./hash.js";
import { safeMarkdownFiles } from "./ingest.js";
import { parseMarkdown } from "./markdown.js";
import { storyNoteMetadataSchema } from "./story-archive-contract.js";

export const ARCHIVE_AUDIT_VERSION = 1;
export const requiredStoryMetadataFields = [
  "id", "title", "type", "status", "primary_category",
  "categories", "regions", "eras", "aliases", "created",
] as const;

export interface MetadataIssue {
  field: string;
  message: string;
}

export interface ArchiveMigrationAuditFile {
  relativePath: string;
  sourceHash: string;
  title: string;
  existingFields: string[];
  missingFields: string[];
  invalidFields: MetadataIssue[];
  validMetadata: boolean;
  proposedId: string | null;
}

export interface ArchiveMigrationAudit {
  auditVersion: number;
  rootId: string;
  rootDisplayName: string;
  filesSeen: number;
  filesOpened: number;
  readyFiles: number;
  migrationRequiredFiles: number;
  errors: string[];
  manifestHash: string;
  files: ArchiveMigrationAuditFile[];
}

function proposedPermanentId(rootId: string, relativePath: string, title: string, type: unknown): string {
  const typeSlug = typeof type === "string"
    ? type.normalize("NFKD").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")
    : "note";
  const titleSlug = title.normalize("NFKD").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || "untitled";
  const suffix = stableId("id", `${rootId}:${relativePath}`).slice(-8);
  const prefix = typeSlug || "note";
  const boundedTitle = titleSlug.slice(0, Math.max(1, 120 - prefix.length - suffix.length - 2)).replace(/-$/, "");
  return `${prefix}-${boundedTitle}-${suffix}`;
}

function auditManifestHash(files: ArchiveMigrationAuditFile[], errors: string[]): string {
  return createHash("sha256").update(JSON.stringify({ files, errors })).digest("hex");
}

export function auditArchiveRoot(config: Config, rootId: string): ArchiveMigrationAudit {
  const root = config.archiveRoots.find((candidate) => candidate.rootId === rootId && candidate.enabled);
  if (!root) throw new Error(`unknown or disabled archive root: ${rootId}`);
  const rootRealPath = realpathSync(root.path);
  const discovered = safeMarkdownFiles(root.path, config.limits.maxFileBytes);
  const files: ArchiveMigrationAuditFile[] = [];
  const errors: string[] = [];
  let filesOpened = 0;

  for (const absolutePath of discovered) {
    const relativePath = relative(rootRealPath, absolutePath);
    try {
      const before = statSync(absolutePath, { bigint: true });
      const descriptor = openSync(absolutePath, "r");
      let buffer: Buffer;
      try {
        buffer = readFileSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      const after = statSync(absolutePath, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) throw new Error("file changed while being read");
      filesOpened += 1;
      const parsed = parseMarkdown(
        stableId("src", `${root.rootId}:${relativePath}`),
        basename(relativePath, extname(relativePath)),
        buffer.toString("utf8"),
      );
      const existingFields = Object.keys(parsed.frontmatter).sort();
      const missingFields = requiredStoryMetadataFields.filter((field) => !(field in parsed.frontmatter));
      const validation = storyNoteMetadataSchema.safeParse(parsed.frontmatter);
      const invalidFields = validation.success ? [] : validation.error.issues
        .filter((issue) => issue.path.length > 0 && !missingFields.includes(String(issue.path[0]) as typeof requiredStoryMetadataFields[number]))
        .map((issue) => ({ field: String(issue.path[0]), message: issue.message }))
        .sort((left, right) => left.field.localeCompare(right.field, "en") || left.message.localeCompare(right.message, "en"));
      files.push({
        relativePath,
        sourceHash: sha256(buffer),
        title: parsed.title,
        existingFields,
        missingFields: [...missingFields],
        invalidFields,
        validMetadata: validation.success && missingFields.length === 0,
        proposedId: typeof parsed.frontmatter.id === "string"
          ? null
          : proposedPermanentId(root.rootId, relativePath, parsed.title, parsed.frontmatter.type),
      });
    } catch (error) {
      errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  errors.sort((left, right) => left.localeCompare(right, "en"));
  const readyFiles = files.filter((file) => file.validMetadata).length;
  return {
    auditVersion: ARCHIVE_AUDIT_VERSION,
    rootId: root.rootId,
    rootDisplayName: root.displayName,
    filesSeen: discovered.length,
    filesOpened,
    readyFiles,
    migrationRequiredFiles: files.length - readyFiles,
    errors,
    manifestHash: auditManifestHash(files, errors),
    files,
  };
}
