import type { FeatherDatabase } from "../database.js";

/**
 * SQL predicate for every archive retrieval route. Aliases are source-code
 * constants, never request data. An entity selector suppresses its source file
 * because all current entity-derived records originate from that file.
 */
export function retrievalVisibleSql(sourceAlias: string, sectionExpression?: string): string {
  const sectionClause = sectionExpression
    ? `OR (rs.selector_type='section_id' AND rs.selector_value=${sectionExpression})`
    : "";
  return `NOT EXISTS (
    SELECT 1 FROM retrieval_suppressions rs
    WHERE rs.status='active' AND (
      (rs.selector_type='source_file_id' AND rs.selector_value=${sourceAlias}.source_file_id)
      OR (rs.selector_type='relative_path' AND rs.selector_value=${sourceAlias}.relative_path)
      ${sectionClause}
      OR (
        rs.selector_type='entity_id' AND EXISTS (
          SELECT 1 FROM entities hidden_entity
          WHERE hidden_entity.entity_id=rs.selector_value
            AND hidden_entity.source_file_id=${sourceAlias}.source_file_id
        )
      )
    )
  )`;
}

export function activeRetrievalSuppressions(database: FeatherDatabase): object[] {
  return database.prepare(`
    SELECT s.suppression_id AS suppressionId, s.repair_id AS repairId,
      s.selector_type AS selectorType, s.selector_value AS selectorValue,
      s.status, s.created_at AS createdAt
    FROM retrieval_suppressions s
    WHERE s.status='active'
    ORDER BY s.created_at, s.suppression_id
  `).all() as object[];
}
