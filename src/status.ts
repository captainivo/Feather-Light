import { SCHEMA_VERSION, type FeatherDatabase } from "./database.js";

export function indexStatus(database: FeatherDatabase): object {
  const counts = database.prepare(`
    SELECT
      (SELECT count(*) FROM source_files WHERE deleted = 0) AS sourceFiles,
      (SELECT count(*) FROM source_sections s JOIN source_files f ON f.source_file_id=s.source_file_id WHERE f.deleted = 0) AS sourceSections,
      (SELECT count(*) FROM wikilinks w JOIN source_sections s ON s.section_id=w.source_section_id JOIN source_files f ON f.source_file_id=s.source_file_id WHERE f.deleted = 0) AS wikilinks,
      (SELECT count(*) FROM entities WHERE retired = 0) AS entities,
      (SELECT count(*) FROM entity_aliases) AS entityAliases,
      (SELECT count(*) FROM entity_duplicate_candidates WHERE review_status = 'pending') AS entityDuplicateCandidates,
      (SELECT count(*) FROM definitions) AS definitions,
      (SELECT count(*) FROM relationships) AS relationships,
      (SELECT count(*) FROM unresolved_entity_links) AS unresolvedEntityLinks,
      (SELECT count(*) FROM assertions) AS assertions,
      (SELECT count(*) FROM relationships WHERE relation_type <> 'source_links_to') AS typedRelationships,
      (SELECT count(*) FROM chronology_events) AS chronologyEvents,
      (SELECT count(*) FROM chronology_periods) AS chronologyPeriods
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
  const environment = database.prepare(`
    SELECT absolute_day AS absoluteDay, earth_date AS earthDate, generated_at AS generatedAt,
      generator_version AS generatorVersion, source
    FROM environment_days ORDER BY absolute_day DESC LIMIT 1
  `).get() ?? null;
  return { status: roots.length > 0 ? "ok" : "not_indexed", schemaVersion: SCHEMA_VERSION, counts, roots, lastRun, environment };
}
