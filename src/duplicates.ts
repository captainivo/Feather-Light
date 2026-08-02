import type { FeatherDatabase } from "./database.js";

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
  const expression = kind === "content" ? "content_hash" : "lower(trim(title))";
  const eligible = kind === "content" ? "deleted = 0 AND size_bytes > 0" : "deleted = 0";
  const keys = database.prepare(`
    SELECT ${expression} AS duplicate_key, count(*) AS count
    FROM source_files
    WHERE ${eligible}
    GROUP BY ${expression}
    HAVING count(*) > 1
    ORDER BY count DESC, duplicate_key
    LIMIT ?
  `).all(limit) as Array<{ duplicate_key: string; count: number }>;
  const filesForKey = database.prepare(`
    SELECT source_file_id AS sourceFileId, title, relative_path AS relativePath,
      content_hash AS contentHash
    FROM source_files
    WHERE ${eligible} AND ${expression} = ?
    ORDER BY relative_path
  `);
  return keys.map((row) => ({
    kind,
    key: row.duplicate_key,
    files: filesForKey.all(row.duplicate_key) as DuplicateFile[],
  }));
}
