import type { FeatherDatabase } from "./database.js";

export interface SectionEvidence {
  sectionId: string;
  sourceFileId: string;
  title: string;
  relativePath: string;
  headingPath: string;
  startLine: number;
  endLine: number;
  sourceHash: string;
  sectionHash: string;
  text: string;
}

export function getSection(database: FeatherDatabase, sectionId: string): SectionEvidence | null {
  return (database.prepare(`
    SELECT s.section_id AS sectionId, s.source_file_id AS sourceFileId,
      f.title, f.relative_path AS relativePath, s.heading_path AS headingPath,
      s.start_line AS startLine, s.end_line AS endLine,
      f.content_hash AS sourceHash, s.section_hash AS sectionHash,
      s.plain_text AS text
    FROM source_sections s
    JOIN source_files f ON f.source_file_id = s.source_file_id
    WHERE s.section_id = ? AND f.deleted = 0
  `).get(sectionId) as SectionEvidence | undefined) ?? null;
}

