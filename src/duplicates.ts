import type { FeatherDatabase } from "./database.js";
import { retrievalVisibleSql } from "./open-hand/suppression.js";

export type DuplicateKind = "content" | "title";

export interface DuplicateFile {
  sourceFileId: string;
  title: string;
  relativePath: string;
  contentHash: string;
}

export interface DuplicateGroup {
  kind: DuplicateKind;
  key: string;
  files: DuplicateFile[];
}

export function findDuplicates(
  database: FeatherDatabase,
  kind: DuplicateKind,
  limit = 25,
): DuplicateGroup[] {
  const expression = kind === "content" ? "f.content_hash" : "lower(trim(f.title))";
  const eligible = kind === "content" ? "f.deleted = 0 AND f.size_bytes > 0" : "f.deleted = 0";
  const keys = database.prepare(`
    SELECT ${expression} AS duplicate_key, count(*) AS count
    FROM source_files f
    WHERE ${eligible} AND ${retrievalVisibleSql("f")}
    GROUP BY ${expression}
    HAVING count(*) > 1
    ORDER BY count DESC, duplicate_key
    LIMIT ?
  `).all(limit) as Array<{ duplicate_key: string; count: number }>;
  const filesForKey = database.prepare(`
    SELECT f.source_file_id AS sourceFileId, f.title, f.relative_path AS relativePath,
      f.content_hash AS contentHash
    FROM source_files f
    WHERE ${eligible} AND ${retrievalVisibleSql("f")} AND ${expression} = ?
    ORDER BY f.relative_path
  `);
  return keys.map((row) => ({
    kind,
    key: row.duplicate_key,
    files: filesForKey.all(row.duplicate_key) as DuplicateFile[],
  }));
}
