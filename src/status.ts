import type { FeatherDatabase } from "./database.js";

export function indexStatus(database: FeatherDatabase): object {
  const counts = database.prepare(`
    SELECT
      (SELECT count(*) FROM source_files WHERE deleted = 0) AS sourceFiles,
      (SELECT count(*) FROM source_sections s JOIN source_files f ON f.source_file_id=s.source_file_id WHERE f.deleted = 0) AS sourceSections,
      (SELECT count(*) FROM wikilinks w JOIN source_sections s ON s.section_id=w.source_section_id JOIN source_files f ON f.source_file_id=s.source_file_id WHERE f.deleted = 0) AS wikilinks
  `).get();
  const roots = database.prepare(`
    SELECT root_id AS rootId, display_name AS displayName, absolute_path AS path,
      last_complete_ingest_id AS lastCompleteIngestId,
      last_attempted_ingest_id AS lastAttemptedIngestId
    FROM archive_roots ORDER BY root_id
  `).all();
  const lastRun = database.prepare(`
    SELECT ingest_id AS ingestId, root_id AS rootId, started_at AS startedAt,
      finished_at AS finishedAt, status, files_seen AS filesSeen,
      files_opened AS filesOpened, bytes_read AS bytesRead,
      records_changed AS recordsChanged, error_summary AS errorSummary
    FROM ingest_runs ORDER BY started_at DESC LIMIT 1
  `).get() ?? null;
  return { status: roots.length > 0 ? "ok" : "not_indexed", schemaVersion: 1, counts, roots, lastRun };
}

