import { basename } from "node:path";
import type { FeatherDatabase } from "./database.js";
import { type EntityRecord, listEntities, normalizeEntityLabel, rebuildEntities } from "./entities.js";
import { stableId } from "./hash.js";

const DEFINITION_LIMIT = 800;
const preferredHeadings = new Map([
  ["core idea", { priority: 2, confidence: 0.98 }],
  ["summary", { priority: 3, confidence: 0.96 }],
  ["overview", { priority: 4, confidence: 0.94 }],
]);

function cleanMarkdown(value: string): string {
  return value
    .replaceAll(/^#{1,6}\s+.*$/gm, "")
    .replaceAll(/```[\s\S]*?```/g, "")
    .replaceAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, display: string | undefined) => display ?? basename(target))
    .replaceAll(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replaceAll(/[*_~`>#]/g, "")
    .replaceAll(/^\s*[-+]\s+/gm, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function conciseParagraph(value: string): string | null {
  const withoutHeading = value.replaceAll(/^#{1,6}\s+.*$/gm, "").trim();
  const paragraphs = withoutHeading.split(/\n\s*\n/).map(cleanMarkdown).filter(Boolean);
  const candidate = paragraphs.find((paragraph) => paragraph.length >= 30) ?? paragraphs[0];
  return candidate ? candidate.slice(0, DEFINITION_LIMIT) : null;
}

function lastHeading(headingPath: string): string {
  return headingPath.split(" > ").at(-1)!.trim().toLocaleLowerCase();
}

function targetLabel(target: string): string {
  const lastSegment = target.replaceAll("\\", "/").split("/").at(-1) ?? target;
  return lastSegment.replace(/\.md$/i, "").trim();
}

export function rebuildKnowledge(database: FeatherDatabase): {
  entities: number;
  aliases: number;
  entityDuplicateCandidates: number;
  entitiesNeedingReview: number;
  definitions: number;
  relationships: number;
  unresolvedLinks: number;
  ambiguousLinks: number;
} {
  const entityBuild = rebuildEntities(database);
  database.transaction(() => {
    database.prepare("DELETE FROM unresolved_entity_links").run();
    database.prepare("DELETE FROM relationships").run();
    database.prepare("DELETE FROM definitions").run();

    const entities = database.prepare(`
      SELECT e.entity_id AS entityId, e.canonical_label AS canonicalLabel,
        e.source_file_id AS sourceFileId, f.frontmatter_json AS frontmatterJson
      FROM entities e JOIN source_files f ON f.source_file_id=e.source_file_id
      WHERE e.retired=0 ORDER BY e.canonical_label
    `).all() as Array<{ entityId: string; canonicalLabel: string; sourceFileId: string; frontmatterJson: string }>;
    const insertDefinition = database.prepare(`
      INSERT INTO definitions(
        definition_id, entity_id, definition_text, definition_kind,
        source_section_id, confidence, is_preferred, review_status, extraction_rule
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entity of entities) {
      const frontmatter = JSON.parse(entity.frontmatterJson) as Record<string, unknown>;
      const sections = database.prepare(`
        SELECT section_id AS sectionId, heading_path AS headingPath,
          ordinal, plain_text AS plainText
        FROM source_sections WHERE source_file_id=? ORDER BY ordinal
      `).all(entity.sourceFileId) as Array<{ sectionId: string; headingPath: string; ordinal: number; plainText: string }>;
      const candidates: Array<{
        text: string; kind: "source_explicit" | "source_derived"; sectionId: string | null;
        confidence: number; priority: number; rule: string; review: "accepted" | "needs_review";
      }> = [];
      if (typeof frontmatter.definition === "string" && frontmatter.definition.trim()) {
        candidates.push({
          text: cleanMarkdown(frontmatter.definition).slice(0, DEFINITION_LIMIT),
          kind: "source_explicit",
          sectionId: sections[0]?.sectionId ?? null,
          confidence: 1,
          priority: 1,
          rule: "frontmatter.definition",
          review: "accepted",
        });
      }
      for (const section of sections) {
        const preferred = preferredHeadings.get(lastHeading(section.headingPath));
        if (!preferred) continue;
        const text = conciseParagraph(section.plainText);
        if (text) candidates.push({
          text,
          kind: "source_derived",
          sectionId: section.sectionId,
          confidence: preferred.confidence,
          priority: preferred.priority,
          rule: `heading.${lastHeading(section.headingPath).replaceAll(" ", "_")}`,
          review: "accepted",
        });
      }
      if (candidates.length === 0) {
        const fallback = sections.map((section) => ({ section, text: conciseParagraph(section.plainText) })).find((entry) => entry.text);
        if (fallback?.text) candidates.push({
          text: fallback.text,
          kind: "source_derived",
          sectionId: fallback.section.sectionId,
          confidence: 0.7,
          priority: 10,
          rule: "first_concise_paragraph",
          review: "needs_review",
        });
      }
      candidates.sort((left, right) => left.priority - right.priority);
      for (const [index, candidate] of candidates.entries()) {
        insertDefinition.run(
          stableId("def", `${entity.entityId}:${candidate.rule}:${candidate.sectionId ?? "frontmatter"}`),
          entity.entityId,
          candidate.text,
          candidate.kind,
          candidate.sectionId,
          candidate.confidence,
          index === 0 ? 1 : 0,
          candidate.review,
          candidate.rule,
        );
      }
    }

    const names = new Map<string, Set<string>>();
    const nameRows = database.prepare(`
      SELECT entity_id AS entityId, normalized_label AS normalizedName FROM entities WHERE retired=0
      UNION ALL
      SELECT entity_id AS entityId, normalized_alias AS normalizedName FROM entity_aliases
    `).all() as Array<{ entityId: string; normalizedName: string }>;
    for (const row of nameRows) {
      const matches = names.get(row.normalizedName) ?? new Set<string>();
      matches.add(row.entityId);
      names.set(row.normalizedName, matches);
    }
    const insertRelationship = database.prepare(`
      INSERT OR IGNORE INTO relationships(
        relationship_id, source_entity_id, relation_type, target_entity_id,
        source_section_id, confidence
      ) VALUES (?, ?, 'source_links_to', ?, ?, 1.0)
    `);
    const insertUnresolved = database.prepare(`
      INSERT OR IGNORE INTO unresolved_entity_links(
        unresolved_link_id, source_entity_id, source_section_id, target_text,
        normalized_target, resolution_status, candidate_entity_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entity of entities) {
      const links = database.prepare(`
        SELECT w.source_section_id AS sectionId, w.target
        FROM wikilinks w
        JOIN source_sections s ON s.section_id=w.source_section_id
        WHERE s.source_file_id=?
      `).all(entity.sourceFileId) as Array<{ sectionId: string; target: string }>;
      for (const link of links) {
        const label = targetLabel(link.target);
        const normalized = normalizeEntityLabel(label);
        const matches = [...(names.get(normalized) ?? [])].sort();
        if (matches.length === 1) {
          const targetId = matches[0]!;
          if (targetId === entity.entityId) continue;
          insertRelationship.run(
            stableId("rel", `${entity.entityId}:${targetId}:${link.sectionId}`),
            entity.entityId,
            targetId,
            link.sectionId,
          );
        } else {
          const status = matches.length > 1 ? "ambiguous" : "unresolved";
          insertUnresolved.run(
            stableId("unr", `${entity.entityId}:${link.sectionId}:${normalized}`),
            entity.entityId,
            link.sectionId,
            label,
            normalized,
            status,
            JSON.stringify(matches),
          );
        }
      }
    }
  })();

  const count = (table: string, where = "") => (database.prepare(`SELECT count(*) AS count FROM ${table} ${where}`).get() as { count: number }).count;
  return {
    entities: entityBuild.entities,
    aliases: entityBuild.aliases,
    entityDuplicateCandidates: entityBuild.duplicateCandidates,
    entitiesNeedingReview: entityBuild.needsReview,
    definitions: count("definitions"),
    relationships: count("relationships"),
    unresolvedLinks: count("unresolved_entity_links", "WHERE resolution_status='unresolved'"),
    ambiguousLinks: count("unresolved_entity_links", "WHERE resolution_status='ambiguous'"),
  };
}

function resolveEntity(database: FeatherDatabase, query: string): string[] {
  if (query.startsWith("ent_")) {
    const exists = database.prepare("SELECT entity_id FROM entities WHERE entity_id=? AND retired=0").get(query);
    return exists ? [query] : [];
  }
  const normalized = normalizeEntityLabel(query);
  const rows = database.prepare(`
    SELECT entity_id AS entityId FROM entities WHERE normalized_label=? AND retired=0
    UNION
    SELECT a.entity_id AS entityId FROM entity_aliases a JOIN entities e ON e.entity_id=a.entity_id
      WHERE a.normalized_alias=? AND e.retired=0
  `).all(normalized, normalized) as Array<{ entityId: string }>;
  return rows.map((row) => row.entityId);
}

export function getEntityBrief(database: FeatherDatabase, query: string, relationLimit = 10): object {
  const matches = resolveEntity(database, query);
  if (matches.length === 0) return { status: "not_found", query };
  if (matches.length > 1) {
    const candidates = matches.map((entityId) => listEntities(database, undefined, 1_000).find((entity) => entity.entityId === entityId));
    return { status: "ambiguous", query, candidates: candidates.filter(Boolean) };
  }
  const entityId = matches[0]!;
  const entity = listEntities(database, undefined, 1_000).find((candidate) => candidate.entityId === entityId) as EntityRecord;
  const definition = database.prepare(`
    SELECT d.definition_id AS definitionId, d.definition_text AS text,
      d.definition_kind AS kind, d.confidence, d.review_status AS reviewStatus,
      d.extraction_rule AS extractionRule, s.heading_path AS sourceHeading,
      s.start_line AS startLine, s.end_line AS endLine, f.content_hash AS sourceHash
    FROM definitions d
    LEFT JOIN source_sections s ON s.section_id=d.source_section_id
    LEFT JOIN source_files f ON f.source_file_id=s.source_file_id
    WHERE d.entity_id=? ORDER BY d.is_preferred DESC, d.confidence DESC LIMIT 1
  `).get(entityId) ?? null;
  const relationships = database.prepare(`
    SELECT r.relationship_id AS relationshipId, r.relation_type AS relationType,
      target.entity_id AS targetEntityId, target.canonical_label AS targetLabel,
      target.entity_type AS targetType, s.section_id AS sourceSectionId,
      s.heading_path AS sourceHeading, s.start_line AS startLine, s.end_line AS endLine
    FROM relationships r
    JOIN entities target ON target.entity_id=r.target_entity_id
    JOIN source_sections s ON s.section_id=r.source_section_id
    WHERE r.source_entity_id=?
    GROUP BY r.target_entity_id
    ORDER BY target.canonical_label LIMIT ?
  `).all(entityId, relationLimit);
  const relationCount = (database.prepare("SELECT count(DISTINCT target_entity_id) AS count FROM relationships WHERE source_entity_id=?").get(entityId) as { count: number }).count;
  return { status: "ok", entity, definition, relationships, relationCount, truncated: relationCount > relationLimit };
}

