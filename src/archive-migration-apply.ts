import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArchiveMigrationChangeSet, parseArchiveMigrationRenderPreview, splitArchiveMarkdown } from "./archive-migration-render.js";
import { sha256 } from "./hash.js";

export interface ArchiveMigrationWriteAuthorization {
  rootId: string;
  rootPath: string;
  expectedPreviewHash: string;
  allowWrite: true;
}

export interface ArchiveMigrationApplyResult {
  status: "applied";
  rootId: string;
  previewHash: string;
  filesApplied: number;
  targetHashes: Array<{ relativePath: string; targetHash: string }>;
}

export function applyArchiveMigration(
  authorization: ArchiveMigrationWriteAuthorization,
  changeSetValue: unknown,
  previewValue: unknown,
): ArchiveMigrationApplyResult {
  const changeSet = parseArchiveMigrationChangeSet(changeSetValue);
  const preview = parseArchiveMigrationRenderPreview(previewValue);
  if (!authorization.allowWrite) throw new Error("explicit write authorization is required");
  if (authorization.rootId !== changeSet.rootId || preview.rootId !== changeSet.rootId) throw new Error("archive root identity mismatch");
  if (authorization.expectedPreviewHash !== preview.previewHash) throw new Error("confirmed preview hash does not match");
  if (preview.changeSetHash !== changeSet.changeSetHash) throw new Error("preview does not belong to change set");
  if (preview.files.length !== changeSet.files.length) throw new Error("preview file count does not match change set");
  const rootPath = realpathSync(authorization.rootPath);
  const prepared: Array<{ path: string; temporary: string; backup: string; targetHash: string; relativePath: string }> = [];
  const transactionId = randomUUID();
  try {
    for (const [index, file] of changeSet.files.entries()) {
      const rendered = preview.files[index];
      if (!rendered || rendered.relativePath !== file.relativePath || rendered.sourceHash !== file.sourceHash) throw new Error("preview file ordering or identity mismatch");
      const path = join(rootPath, file.relativePath);
      if (relative(rootPath, path).startsWith("..")) throw new Error("migration path escapes archive root");
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`migration target is not a regular file: ${file.relativePath}`);
      const original = readFileSync(path);
      if (sha256(original) !== file.sourceHash) throw new Error(`source changed before apply: ${file.relativePath}`);
      const body = splitArchiveMarkdown(original.toString("utf8")).body;
      if (sha256(body) !== rendered.bodyHash) throw new Error(`body hash mismatch: ${file.relativePath}`);
      const content = `${rendered.renderedFrontmatter}${body}`;
      if (sha256(content) !== rendered.targetHash) throw new Error(`target hash mismatch: ${file.relativePath}`);
      const temporary = join(dirname(path), `.feather-light-${transactionId}-${index}.tmp`);
      const backup = join(dirname(path), `.feather-light-${transactionId}-${index}.bak`);
      const descriptor = openSync(temporary, "wx", stat.mode & 0o777);
      try {
        writeFileSync(descriptor, content);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      prepared.push({ path, temporary, backup, targetHash: rendered.targetHash, relativePath: file.relativePath });
    }
    let installed = 0;
    try {
      for (const file of prepared) {
        renameSync(file.path, file.backup);
        try {
          renameSync(file.temporary, file.path);
        } catch (error) {
          renameSync(file.backup, file.path);
          throw error;
        }
        installed += 1;
      }
    } catch (error) {
      for (let index = installed - 1; index >= 0; index -= 1) renameSync(prepared[index]!.backup, prepared[index]!.path);
      throw error;
    }
    for (const file of prepared) rmSync(file.backup);
    return { status: "applied", rootId: changeSet.rootId, previewHash: preview.previewHash, filesApplied: prepared.length, targetHashes: prepared.map((file) => ({ relativePath: file.relativePath, targetHash: file.targetHash })) };
  } finally {
    for (const file of prepared) {
      rmSync(file.temporary, { force: true });
      rmSync(file.backup, { force: true });
    }
  }
}
