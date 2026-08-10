import { Dirent, lstatSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import type { Config } from "./config.js";
import { SCHEMA_VERSION, type FeatherDatabase } from "./database.js";
import { newIngestId, sha256, stableId } from "./hash.js";
import { parseMarkdown } from "./markdown.js";
import type { IngestResult, ParsedMarkdown } from "./types.js";

const PARSER_VERSION = "2";
const excludedNames = new Set([".git", ".obsidian", ".trash", ".DS_Store"]);

function safeMarkdownFiles(rootPath: string, maxFileBytes: number): string[] {
  const root = realpathSync(rootPath);
  const found: string[] = [];
  const walk = (directory: string): void => {
    const entries: Dirent[] = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (excludedNames.has(entry.name) || entry.name.startsWith("._") || entry.name.endsWith("~")) continue;
      const path = resolve(directory, entry.name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) continue;
      const real = realpathSync(path);
      if (real !== root && !real.startsWith(`${root}${sep}`)) throw new Error(`path escaped archive root: ${path}`);
      if (info.isDirectory()) walk(path);
      else if (info.isFile() && extname(entry.name).toLowerCase() === ".md" && info.size <= maxFileBytes) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

function replaceFile(
  database: FeatherDatabase,
  values: {
    rootId: string;
    ingestId: string;
    sourceFileId: string;
    relativePath: string;
    sizeBytes: number;
    mtimeNs: string;
    contentHash: string;
    parsed: ParsedMarkdown;
  },
): void {
  database.transaction(() => {
    const previous = database.prepare("SELECT first_seen_ingest_id FROM source_files WHERE source_file_id = ?").get(values.sourceFileId) as
      | { first_seen_ingest_id: string }
      | undefined;
    if (previous) {
      const oldSections = database.prepare(`
        SELECT section_id, heading_path, section_hash
        FROM source_sections WHERE source_file_id = ?
      `).all(values.sourceFileId) as Array<{ section_id: string; heading_path: string; section_hash: string }>;
      const newByHash = new Map<string, typeof values.parsed.sections>();
      const newByHeading = new Map<string, typeof values.parsed.sections>();
      for (const section of values.parsed.sections) {
        const hashMatches = newByHash.get(section.sectionHash) ?? [];
        hashMatches.push(section);
        newByHash.set(section.sectionHash, hashMatches);
        const headingMatches = newByHeading.get(section.headingPath) ?? [];
        headingMatches.push(section);
        newByHeading.set(section.headingPath, headingMatches);
      }
      const remapSuppression = database.prepare(`
        UPDATE retrieval_suppressions SET selector_value=?
        WHERE status='active' AND selector_type='section_id' AND selector_value=?
      `);
      for (const oldSection of oldSections) {
        const hashMatches = newByHash.get(oldSection.section_hash) ?? [];
        const headingMatches = newByHeading.get(oldSection.heading_path) ?? [];
        const replacement = hashMatches.length === 1 ? hashMatches[0] : headingMatches.length === 1 ? headingMatches[0] : undefined;
        if (replacement && replacement.sectionId !== oldSection.section_id) {
          remapSuppression.run(replacement.sectionId, oldSection.section_id);
        }
      }
      const deleteFts = database.prepare("DELETE FROM sections_fts WHERE section_id = ?");
      for (const section of oldSections) deleteFts.run(section.section_id);
      database.prepare("DELETE FROM source_sections WHERE source_file_id = ?").run(values.sourceFileId);
    }
    database.prepare(`
      INSERT INTO source_files (
        source_file_id, root_id, relative_path, extension, size_bytes, mtime_ns,
        content_hash, encoding, title, frontmatter_json, first_seen_ingest_id,
        last_seen_ingest_id, deleted
      ) VALUES (?, ?, ?, '.md', ?, ?, ?, 'utf-8', ?, ?, ?, ?, 0)
      ON CONFLICT(source_file_id) DO UPDATE SET
        relative_path=excluded.relative_path, size_bytes=excluded.size_bytes,
        mtime_ns=excluded.mtime_ns, content_hash=excluded.content_hash,
        title=excluded.title, frontmatter_json=excluded.frontmatter_json,
        last_seen_ingest_id=excluded.last_seen_ingest_id, deleted=0
    `).run(
      values.sourceFileId,
      values.rootId,
      values.relativePath,
      values.sizeBytes,
      values.mtimeNs,
      values.contentHash,
      values.parsed.title,
      JSON.stringify(values.parsed.frontmatter),
      previous?.first_seen_ingest_id ?? values.ingestId,
      values.ingestId,
    );
    const insertSection = database.prepare(`
      INSERT INTO source_sections (
        section_id, source_file_id, heading_path, heading_level, ordinal,
        start_line, end_line, section_hash, plain_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLink = database.prepare(`
      INSERT INTO wikilinks (wikilink_id, source_section_id, target, target_heading, display_text)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertFts = database.prepare("INSERT INTO sections_fts(section_id, title, heading_path, body) VALUES (?, ?, ?, ?)");
    for (const section of values.parsed.sections) {
      insertSection.run(
        section.sectionId,
        values.sourceFileId,
        section.headingPath,
        section.headingLevel,
        section.ordinal,
        section.startLine,
        section.endLine,
        section.sectionHash,
        section.plainText,
      );
      insertFts.run(section.sectionId, values.parsed.title, section.headingPath, section.plainText);
      for (const [index, link] of section.wikilinks.entries()) {
        insertLink.run(stableId("lnk", `${section.sectionId}:${index}:${link.target}`), section.sectionId, link.target, link.targetHeading, link.displayText);
      }
    }
  })();
}

function ingestRootUnlocked(database: FeatherDatabase, config: Config, rootId: string, dryRun = false): IngestResult {
  const root = config.archiveRoots.find((candidate) => candidate.rootId === rootId && candidate.enabled);
  if (!root) throw new Error(`unknown or disabled archive root: ${rootId}`);
  const ingestId = newIngestId();
  const startedAt = new Date().toISOString();
  let rootRealPath = root.path;
  const result: IngestResult = { ingestId, rootId, status: "failed", filesSeen: 0, filesOpened: 0, bytesRead: 0, recordsChanged: 0, errors: [], dryRun };
  const lastComplete = database.prepare(`
    SELECT run.parser_version AS parserVersion
    FROM archive_roots root
    LEFT JOIN ingest_runs run ON run.ingest_id = root.last_complete_ingest_id
    WHERE root.root_id = ?
  `).get(root.rootId) as { parserVersion: string | null } | undefined;
  const forceReparse = lastComplete?.parserVersion !== PARSER_VERSION;
  if (!dryRun) {
    database.prepare(`
      INSERT INTO archive_roots(root_id, display_name, absolute_path, read_only, enabled, last_attempted_ingest_id)
      VALUES (?, ?, ?, 1, 1, ?)
      ON CONFLICT(root_id) DO UPDATE SET display_name=excluded.display_name,
        absolute_path=excluded.absolute_path, enabled=1, last_attempted_ingest_id=excluded.last_attempted_ingest_id
    `).run(root.rootId, root.displayName, root.path, ingestId);
    database.prepare(`
      INSERT INTO ingest_runs(ingest_id, root_id, started_at, status, parser_version, schema_version)
      VALUES (?, ?, ?, 'running', ?, ?)
    `).run(ingestId, root.rootId, startedAt, PARSER_VERSION, SCHEMA_VERSION);
  }

  let discovered: string[] = [];
  try {
    rootRealPath = realpathSync(root.path);
    discovered = safeMarkdownFiles(root.path, config.limits.maxFileBytes);
    result.filesSeen = discovered.length;
    for (const absolutePath of discovered) {
      try {
        const infoBefore = statSync(absolutePath, { bigint: true });
        const descriptor = openSync(absolutePath, "r");
        const buffer = readFileSync(descriptor);
        closeSync(descriptor);
        const infoAfter = statSync(absolutePath, { bigint: true });
        if (infoBefore.size !== infoAfter.size || infoBefore.mtimeNs !== infoAfter.mtimeNs) throw new Error("file changed while being read");
        result.filesOpened += 1;
        result.bytesRead += buffer.byteLength;
        const relativePath = relative(rootRealPath, absolutePath);
        const sourceFileId = stableId("src", `${root.rootId}:${relativePath}`);
        const contentHash = sha256(buffer);
        const prior = database.prepare("SELECT content_hash, deleted FROM source_files WHERE source_file_id = ?").get(sourceFileId) as
          | { content_hash: string; deleted: number }
          | undefined;
        if (!forceReparse && prior?.content_hash === contentHash && prior.deleted === 0) {
          if (!dryRun) database.prepare("UPDATE source_files SET last_seen_ingest_id = ? WHERE source_file_id = ?").run(ingestId, sourceFileId);
          continue;
        }
        const parsed = parseMarkdown(sourceFileId, basename(relativePath, extname(relativePath)), buffer.toString("utf8"));
        result.recordsChanged += 1;
        if (!dryRun) replaceFile(database, {
          rootId: root.rootId,
          ingestId,
          sourceFileId,
          relativePath,
          sizeBytes: Number(infoAfter.size),
          mtimeNs: infoAfter.mtimeNs.toString(),
          contentHash,
          parsed,
        });
      } catch (error) {
        result.errors.push(`${relative(rootRealPath, absolutePath)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    result.status = result.errors.length === 0 ? "complete" : "partial";
    if (!dryRun && result.status === "complete") {
      database.prepare("UPDATE source_files SET deleted = 1 WHERE root_id = ? AND last_seen_ingest_id <> ?").run(root.rootId, ingestId);
      database.prepare("UPDATE archive_roots SET last_complete_ingest_id = ? WHERE root_id = ?").run(ingestId, root.rootId);
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    result.status = "failed";
  }
  if (!dryRun) {
    database.prepare(`
      UPDATE ingest_runs SET finished_at=?, status=?, files_seen=?, files_opened=?,
        bytes_read=?, records_changed=?, error_summary=? WHERE ingest_id=?
    `).run(new Date().toISOString(), result.status, result.filesSeen, result.filesOpened, result.bytesRead, result.recordsChanged, result.errors.length ? result.errors.join("\n") : null, ingestId);
  }
  return result;
}

/** Serialize a complete archive snapshot so concurrent ingests cannot invalidate each other's last-seen generation. */
export function ingestRoot(database: FeatherDatabase, config: Config, rootId: string, dryRun = false): IngestResult {
  return database.transaction(() => ingestRootUnlocked(database, config, rootId, dryRun))();
}
