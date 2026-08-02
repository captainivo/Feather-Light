import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";

export interface SearchResult {
  sectionId: string;
  sourceFileId: string;
  title: string;
  relativePath: string;
  headingPath: string;
  startLine: number;
  endLine: number;
  sourceHash: string;
  sectionHash: string;
  excerpt: string;
  score: number;
}

function ftsQuery(query: string): string {
  const terms = query.match(/[\p{L}\p{N}'’-]+/gu)?.filter((term) => term.length > 1) ?? [];
  if (terms.length === 0) throw new Error("query requires searchable terms");
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

export function search(database: FeatherDatabase, config: Config, query: string, requestedLimit?: number): SearchResult[] {
  const limit = Math.min(requestedLimit ?? config.limits.searchResults, config.limits.searchResults);
  const rows = database.prepare(`
    SELECT s.section_id, s.source_file_id, f.title, f.relative_path, s.heading_path,
      s.start_line, s.end_line, f.content_hash, s.section_hash, s.plain_text,
      bm25(sections_fts, 0, 8, 4, 1) AS score
    FROM sections_fts
    JOIN source_sections s ON s.section_id = sections_fts.section_id
    JOIN source_files f ON f.source_file_id = s.source_file_id
    WHERE sections_fts MATCH ? AND f.deleted = 0
    ORDER BY score, f.relative_path, s.ordinal
    LIMIT ?
  `).all(ftsQuery(query), limit) as Array<{
    section_id: string; source_file_id: string; title: string; relative_path: string;
    heading_path: string; start_line: number; end_line: number; content_hash: string;
    section_hash: string; plain_text: string; score: number;
  }>;
  return rows.map((row) => ({
    sectionId: row.section_id,
    sourceFileId: row.source_file_id,
    title: row.title,
    relativePath: row.relative_path,
    headingPath: row.heading_path,
    startLine: row.start_line,
    endLine: row.end_line,
    sourceHash: row.content_hash,
    sectionHash: row.section_hash,
    excerpt: row.plain_text.slice(0, config.limits.excerptCharacters),
    score: row.score,
  }));
}

