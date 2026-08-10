import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { Config } from "./config.js";
import { sha256, stableId } from "./hash.js";
import { parseMarkdown } from "./markdown.js";
import { storyNoteMetadataSchema } from "./story-archive-contract.js";

const changeSchema = z.object({
  field: z.string().min(1),
  value: z.unknown(),
  authority: z.enum(["mechanical", "approved", "replaced"]),
  reviewer: z.string().min(1).optional(),
  decidedAt: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((change, context) => {
  if (change.authority !== "mechanical" && (!change.reviewer || !change.decidedAt)) context.addIssue({ code: "custom", message: "reviewed changes require provenance" });
  if (change.authority === "mechanical" && (change.reviewer || change.decidedAt)) context.addIssue({ code: "custom", message: "mechanical changes cannot claim review provenance" });
});

const changeSetCoreSchema = z.object({
  changeSetVersion: z.literal(1),
  rootId: z.string().min(1),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  readOnly: z.literal(true),
  files: z.array(z.object({
    relativePath: z.string().min(1).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes("..")),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    changes: z.array(changeSchema),
  }).strict()),
}).strict();

export const archiveMigrationChangeSetSchema = changeSetCoreSchema.extend({ changeSetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ParsedArchiveMigrationChangeSet = z.infer<typeof archiveMigrationChangeSetSchema>;

export function parseArchiveMigrationChangeSet(value: unknown): ParsedArchiveMigrationChangeSet {
  const changeSet = archiveMigrationChangeSetSchema.parse(value);
  const { changeSetHash, ...core } = changeSet;
  if (sha256(JSON.stringify(core)) !== changeSetHash) throw new Error("change set hash does not match content");
  const paths = new Set<string>();
  for (const file of changeSet.files) {
    if (paths.has(file.relativePath)) throw new Error(`duplicate change-set path: ${file.relativePath}`);
    paths.add(file.relativePath);
    const fields = new Set<string>();
    for (const change of file.changes) {
      if (fields.has(change.field)) throw new Error(`duplicate change-set field: ${file.relativePath}:${change.field}`);
      fields.add(change.field);
    }
  }
  return changeSet;
}

export function splitArchiveMarkdown(text: string): { yaml: string; body: string; eol: "\n" | "\r\n" } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const opening = text.match(/^---\r?\n/);
  if (!opening) return { yaml: "", body: text, eol };
  const remainder = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(remainder);
  if (!closing || closing.index === undefined) throw new Error("unterminated YAML frontmatter");
  return { yaml: remainder.slice(0, closing.index), body: remainder.slice(closing.index + closing[0].length), eol };
}

export interface ArchiveMigrationRenderPreview {
  previewVersion: 1;
  rootId: string;
  changeSetHash: string;
  readOnly: true;
  files: Array<{ relativePath: string; sourceHash: string; targetHash: string; bodyHash: string; renderedFrontmatter: string }>;
  previewHash: string;
}

const renderPreviewCoreSchema = z.object({
  previewVersion: z.literal(1), rootId: z.string().min(1), changeSetHash: z.string().regex(/^[a-f0-9]{64}$/), readOnly: z.literal(true),
  files: z.array(z.object({ relativePath: z.string().min(1), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), targetHash: z.string().regex(/^[a-f0-9]{64}$/), bodyHash: z.string().regex(/^[a-f0-9]{64}$/), renderedFrontmatter: z.string().startsWith("---") }).strict()),
}).strict();
export const archiveMigrationRenderPreviewSchema = renderPreviewCoreSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export function parseArchiveMigrationRenderPreview(value: unknown): ArchiveMigrationRenderPreview {
  const preview = archiveMigrationRenderPreviewSchema.parse(value);
  const { previewHash, ...core } = preview;
  if (sha256(JSON.stringify(core)) !== previewHash) throw new Error("render preview hash does not match content");
  return preview;
}

export function renderArchiveMigrationPreview(config: Config, changeSetValue: unknown): ArchiveMigrationRenderPreview {
  const changeSet = parseArchiveMigrationChangeSet(changeSetValue);
  const root = config.archiveRoots.find((candidate) => candidate.rootId === changeSet.rootId && candidate.enabled);
  if (!root) throw new Error(`unknown or disabled archive root: ${changeSet.rootId}`);
  const rootPath = realpathSync(root.path);
  const files = changeSet.files.map((file) => {
    const absolutePath = join(rootPath, file.relativePath);
    if (relative(rootPath, absolutePath).startsWith("..")) throw new Error("change-set path escapes archive root");
    const original = readFileSync(absolutePath);
    if (sha256(original) !== file.sourceHash) throw new Error(`source changed after change-set creation: ${file.relativePath}`);
    const text = original.toString("utf8");
    const parts = splitArchiveMarkdown(text);
    const document = parseDocument(parts.yaml);
    if (document.errors.length > 0) throw new Error(`invalid YAML frontmatter: ${file.relativePath}`);
    for (const change of file.changes) document.set(change.field, change.value);
    let yaml = document.toString({ lineWidth: 0 });
    yaml = yaml.replaceAll("\n", parts.eol);
    if (!yaml.endsWith(parts.eol)) yaml += parts.eol;
    const renderedFrontmatter = `---${parts.eol}${yaml}---${parts.eol}`;
    const rendered = `${renderedFrontmatter}${parts.body}`;
    const parsed = parseMarkdown(stableId("preview", `${changeSet.rootId}:${file.relativePath}`), file.relativePath, rendered);
    const validation = storyNoteMetadataSchema.safeParse(parsed.frontmatter);
    if (!validation.success) throw new Error(`rendered metadata is invalid: ${file.relativePath}`);
    return { relativePath: file.relativePath, sourceHash: file.sourceHash, targetHash: sha256(rendered), bodyHash: sha256(parts.body), renderedFrontmatter };
  });
  const core = { previewVersion: 1 as const, rootId: changeSet.rootId, changeSetHash: changeSet.changeSetHash, readOnly: true as const, files };
  return { ...core, previewHash: sha256(JSON.stringify(core)) };
}
