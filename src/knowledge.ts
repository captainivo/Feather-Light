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

const structuredRelations = new Map<string, string>([
  ["region", "located_in"],
  ["planet", "located_in"],
  ["world", "located_in"],
  ["location", "located_in"],
  ["home", "located_in"],
  ["current_location", "located_in"],
  ["continent", "located_in"],
  ["preceded_by", "preceded_by"],
  ["followed_by", "followed_by"],
  ["people", "associated_with"],
  ["civilization", "associated_with"],
  ["system", "associated_with"],
  ["artifact", "associated_with"],
  ["species", "associated_with"],
  ["origin", "associated_with"],
  ["descended_from", "associated_with"],
  ["declared_by", "associated_with"],
  ["associated_avor", "associated_with"],
  ["paired_city", "associated_with"],
  ["related_character", "associated_with"],
  ["related", "associated_with"],
  ["nearby", "associated_with"],
  ["moon", "associated_with"],
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

function structuredTargets(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const targets: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const links = [...item.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => targetLabel(match[1]!));
    if (links.length > 0) targets.push(...links);
    else targets.push(...item.split(/[,;]/).map((part) => part.trim()).filter(Boolean));
  }
  return [...new Set(targets)];
}

function bulletClaims(value: string): string[] {
  return value
    .replaceAll(/^#{1,6}\s+.*$/gm, "")
    .split("\n")
    .map((line) => line.match(/^\s*[-*+]\s+(.+?)\s*$/)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
    .map(cleanMarkdown)
    .filter((line) => line.length >= 10);
}

function knowledgeStatus(canonStatus: unknown): {
  status: "known" | "unconfirmed" | "reported" | "speculation" | "contested" | "unknown";
  confidence: number;
} {
  const normalized = typeof canonStatus === "string" ? canonStatus.toLocaleLowerCase() : "";
  if (normalized.includes("conflict") || normalized.includes("contest")) return { status: "contested", confidence: 0.6 };
  if (normalized.includes("unconfirm")) return { status: "unconfirmed", confidence: 0.7 };
  if (normalized.includes("speculat")) return { status: "speculation", confidence: 0.4 };
  if (normalized.includes("develop") || normalized.includes("draft")) return { status: "unconfirmed", confidence: 0.75 };
  if (normalized.includes("canon") || normalized.includes("confirm")) return { status: "known", confidence: 1 };
  return { status: "unknown", confidence: 0.65 };
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
  assertions: number;
  typedRelationships: number;
} {
  const entityBuild = rebuildEntities(database);
  database.transaction(() => {
    database.prepare("DELETE FROM unresolved_entity_links").run();
    database.prepare("DELETE FROM relationships").run();
    database.prepare("DELETE FROM definitions").run();
    database.prepare("DELETE FROM assertions").run();

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
        source_section_id, confidence, extraction_rule
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
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
            "source_links_to",
            targetId,
            link.sectionId,
            1,
            "wikilink",
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

      const frontmatter = JSON.parse(entity.frontmatterJson) as Record<string, unknown>;
      for (const [field, relationType] of structuredRelations) {
        for (const label of structuredTargets(frontmatter[field])) {
          const normalized = normalizeEntityLabel(label);
          const matches = [...(names.get(normalized) ?? [])];
          if (matches.length !== 1 || matches[0] === entity.entityId) continue;
          const targetId = matches[0]!;
          insertRelationship.run(
            stableId("rel", `${entity.entityId}:${relationType}:${targetId}:frontmatter.${field}`),
            entity.entityId,
            relationType,
            targetId,
            null,
            1,
            `frontmatter.${field}`,
          );
        }
      }

      const assertionStatus = knowledgeStatus(frontmatter.canon);
      const knownFactSections = database.prepare(`
        SELECT section_id AS sectionId, plain_text AS plainText
        FROM source_sections
        WHERE source_file_id=? AND lower(heading_path) LIKE '% > known facts'
      `).all(entity.sourceFileId) as Array<{ sectionId: string; plainText: string }>;
      const insertAssertion = database.prepare(`
        INSERT INTO assertions(
          assertion_id, subject_entity_id, predicate, object_entity_id,
          claim_text, source_section_id, canon_status, knowledge_status,
          confidence, review_status, extraction_rule
        ) VALUES (?, ?, 'archive_claim', ?, ?, ?, ?, ?, ?, 'accepted', 'heading.known_facts.bullet')
      `);
      for (const section of knownFactSections) {
        for (const [index, claim] of bulletClaims(section.plainText).entries()) {
          insertAssertion.run(
            stableId("ast", `${entity.entityId}:${section.sectionId}:${index}:${claim}`),
            entity.entityId,
            null,
            claim,
            section.sectionId,
            typeof frontmatter.canon === "string" ? frontmatter.canon : null,
            assertionStatus.status,
            assertionStatus.confidence,
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
    assertions: count("assertions"),
    typedRelationships: count("relationships", "WHERE relation_type <> 'source_links_to'"),
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
    LEFT JOIN source_sections s ON s.section_id=r.source_section_id
    WHERE r.source_entity_id=?
      AND r.relationship_id = (
        SELECT r2.relationship_id FROM relationships r2
        WHERE r2.source_entity_id=r.source_entity_id
          AND r2.target_entity_id=r.target_entity_id
        ORDER BY CASE WHEN r2.relation_type='source_links_to' THEN 1 ELSE 0 END,
          r2.confidence DESC, r2.relationship_id
        LIMIT 1
      )
    ORDER BY target.canonical_label LIMIT ?
  `).all(entityId, relationLimit);
  const relationCount = (database.prepare("SELECT count(DISTINCT target_entity_id) AS count FROM relationships WHERE source_entity_id=?").get(entityId) as { count: number }).count;
  return { status: "ok", entity, definition, relationships, relationCount, truncated: relationCount > relationLimit };
}

export function getEntityAssertions(database: FeatherDatabase, query: string, limit = 25): object {
  const matches = resolveEntity(database, query);
  if (matches.length === 0) return { status: "not_found", query };
  if (matches.length > 1) return { status: "ambiguous", query, entityIds: matches };
  const entityId = matches[0]!;
  const entity = database.prepare(`
    SELECT entity_id AS entityId, canonical_label AS canonicalLabel,
      entity_type AS entityType FROM entities WHERE entity_id=?
  `).get(entityId);
  const assertions = database.prepare(`
    SELECT a.assertion_id AS assertionId, a.predicate, a.claim_text AS claimText,
      a.canon_status AS canonStatus, a.knowledge_status AS knowledgeStatus,
      a.confidence, a.review_status AS reviewStatus,
      s.section_id AS sourceSectionId, s.heading_path AS sourceHeading,
      s.start_line AS startLine, s.end_line AS endLine,
      f.relative_path AS relativePath, f.content_hash AS sourceHash
    FROM assertions a
    JOIN source_sections s ON s.section_id=a.source_section_id
    JOIN source_files f ON f.source_file_id=s.source_file_id
    WHERE a.subject_entity_id=?
    ORDER BY s.ordinal, a.assertion_id LIMIT ?
  `).all(entityId, limit);
  const total = (database.prepare("SELECT count(*) AS count FROM assertions WHERE subject_entity_id=?").get(entityId) as { count: number }).count;
  return { status: "ok", entity, assertions, total, truncated: total > limit };
}
