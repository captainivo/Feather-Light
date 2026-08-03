import type { FeatherDatabase } from "./database.js";
import { retrievalVisibleSql } from "./open-hand/suppression.js";
import { stableId } from "./hash.js";

export type EntityType =
  | "Person"
  | "Place"
  | "Organization"
  | "Species"
  | "Culture"
  | "Civilization"
  | "Artifact"
  | "Technology"
  | "Event"
  | "Concept";

export interface EntityRecord {
  entityId: string;
  entityType: EntityType;
  canonicalLabel: string;
  normalizedLabel: string;
  sourceFileId: string;
  relativePath: string;
  sourceType: string | null;
  canonStatus: string | null;
  confidence: number;
  reviewStatus: "accepted" | "needs_review";
  classificationReason: string;
  aliases: string[];
}

const explicitTypes = new Map<string, EntityType>([
  ["character", "Person"],
  ["place", "Place"],
  ["location", "Place"],
  ["city", "Place"],
  ["region", "Place"],
  ["planet", "Place"],
  ["moon", "Place"],
  ["continent", "Place"],
  ["institution", "Organization"],
  ["species", "Species"],
  ["being", "Species"],
  ["people", "Culture"],
  ["tribe", "Culture"],
  ["civilization", "Civilization"],
  ["artifact", "Artifact"],
  ["system", "Technology"],
  ["species-system", "Technology"],
  ["event", "Event"],
  ["concept", "Concept"],
  ["theme", "Concept"],
  ["terminology", "Concept"],
  ["cultural-role", "Concept"],
  ["class", "Concept"],
  ["lore", "Concept"],
]);

const folderTypes: Array<[string, EntityType]> = [
  ["03 - Characters/", "Person"],
  ["05 - Places/", "Place"],
  ["06 - Systems/", "Technology"],
  ["09 - Lore Library/", "Concept"],
];

const excludedFolders = ["99 - Source Notes/", "11 - Templates/", "13 - TODO/", "10 - Drafting/"];
const excludedSourceTypes = new Set(["index", "artifact-index", "todo", "overview", "drafting", "source-processing"]);
const contextDependentTypes = new Set(["planetary-system", "planetary system"]);

export function normalizeEntityLabel(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll(/[’‘`]/g, "'")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function aliasValues(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function classification(relativePath: string, frontmatter: Record<string, unknown>): {
  entityType: EntityType;
  confidence: number;
  reviewStatus: "accepted" | "needs_review";
  reason: string;
} | null {
  if (excludedFolders.some((folder) => relativePath.startsWith(folder))) return null;
  const sourceType = stringValue(frontmatter.type)?.toLocaleLowerCase() ?? null;
  if (sourceType && excludedSourceTypes.has(sourceType)) return null;
  const explicit = sourceType ? explicitTypes.get(sourceType) : undefined;
  const folder = folderTypes.find(([prefix]) => relativePath.startsWith(prefix));
  if (sourceType && contextDependentTypes.has(sourceType)) {
    if (!folder) return null;
    return {
      entityType: folder[1],
      confidence: 0.85,
      reviewStatus: "needs_review",
      reason: `frontmatter type '${sourceType}' is context-dependent; folder '${folder[0]}' suggests ${folder[1]}`,
    };
  }
  if (explicit) {
    return {
      entityType: explicit,
      confidence: 1,
      reviewStatus: "accepted",
      reason: `frontmatter type '${sourceType}' maps to ${explicit}`,
    };
  }
  if (folder) {
    return {
      entityType: folder[1],
      confidence: 0.7,
      reviewStatus: "needs_review",
      reason: `folder '${folder[0]}' suggests ${folder[1]}; no recognized frontmatter type`,
    };
  }
  return null;
}

export function rebuildEntities(database: FeatherDatabase): {
  entities: number;
  aliases: number;
  duplicateCandidates: number;
  needsReview: number;
} {
  const files = database.prepare(`
    SELECT source_file_id AS sourceFileId, relative_path AS relativePath,
      title, frontmatter_json AS frontmatterJson
    FROM source_files WHERE deleted = 0 ORDER BY relative_path
  `).all() as Array<{ sourceFileId: string; relativePath: string; title: string; frontmatterJson: string }>;

  database.transaction(() => {
    database.prepare("DELETE FROM entity_duplicate_candidates").run();
    database.prepare("DELETE FROM entity_aliases").run();
    database.prepare("DELETE FROM entities").run();
    const insertEntity = database.prepare(`
      INSERT INTO entities (
        entity_id, entity_type, canonical_label, normalized_label, source_file_id,
        source_type, canon_status, confidence, review_status, classification_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAlias = database.prepare(`
      INSERT OR IGNORE INTO entity_aliases(alias_id, entity_id, alias_text, normalized_alias, confidence)
      VALUES (?, ?, ?, ?, 1.0)
    `);
    for (const file of files) {
      const frontmatter = JSON.parse(file.frontmatterJson) as Record<string, unknown>;
      if (
        file.relativePath.endsWith("/Untitled.md") ||
        file.relativePath === "03 - Characters/Characters.md" ||
        normalizeEntityLabel(file.title) === "character name"
      ) continue;
      const classified = classification(file.relativePath, frontmatter);
      if (!classified) continue;
      const entityId = stableId("ent", file.sourceFileId);
      const sourceType = stringValue(frontmatter.type);
      insertEntity.run(
        entityId,
        classified.entityType,
        file.title,
        normalizeEntityLabel(file.title),
        file.sourceFileId,
        sourceType,
        stringValue(frontmatter.canon),
        classified.confidence,
        classified.reviewStatus,
        classified.reason,
      );
      for (const alias of aliasValues(frontmatter.aliases)) {
        const normalized = normalizeEntityLabel(alias);
        if (!normalized || normalized === normalizeEntityLabel(file.title)) continue;
        insertAlias.run(stableId("als", `${entityId}:${normalized}`), entityId, alias, normalized);
      }
    }

    const entities = database.prepare("SELECT entity_id AS entityId, normalized_label AS normalizedLabel FROM entities").all() as Array<{ entityId: string; normalizedLabel: string }>;
    const aliases = database.prepare("SELECT entity_id AS entityId, normalized_alias AS normalizedAlias FROM entity_aliases").all() as Array<{ entityId: string; normalizedAlias: string }>;
    const names = new Map<string, Set<string>>();
    for (const entity of entities) {
      const group = names.get(entity.normalizedLabel) ?? new Set<string>();
      group.add(entity.entityId);
      names.set(entity.normalizedLabel, group);
    }
    for (const alias of aliases) {
      const group = names.get(alias.normalizedAlias) ?? new Set<string>();
      group.add(alias.entityId);
      names.set(alias.normalizedAlias, group);
    }
    const canonicalById = new Map(entities.map((entity) => [entity.entityId, entity.normalizedLabel]));
    const insertCandidate = database.prepare(`
      INSERT OR IGNORE INTO entity_duplicate_candidates(
        candidate_id, left_entity_id, right_entity_id, match_kind, score, reason
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [name, entityIds] of names) {
      const sorted = [...entityIds].sort();
      for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
          const left = sorted[leftIndex]!;
          const right = sorted[rightIndex]!;
          const canonicalMatch = canonicalById.get(left) === name && canonicalById.get(right) === name;
          const kind = canonicalMatch ? "canonical_label" : "alias_collision";
          insertCandidate.run(
            stableId("dup", `${left}:${right}:${kind}`),
            left,
            right,
            kind,
            canonicalMatch ? 1 : 0.85,
            canonicalMatch ? `same normalized canonical label: ${name}` : `shared canonical label or alias: ${name}`,
          );
        }
      }
    }
  })();

  const count = (table: string, where = "") => (database.prepare(`SELECT count(*) AS count FROM ${table} ${where}`).get() as { count: number }).count;
  return {
    entities: count("entities"),
    aliases: count("entity_aliases"),
    duplicateCandidates: count("entity_duplicate_candidates"),
    needsReview: count("entities", "WHERE review_status = 'needs_review'"),
  };
}

export function listEntities(database: FeatherDatabase, entityType?: EntityType, limit = 50): EntityRecord[] {
  const rows = database.prepare(`
    SELECT e.entity_id AS entityId, e.entity_type AS entityType,
      e.canonical_label AS canonicalLabel, e.normalized_label AS normalizedLabel,
      e.source_file_id AS sourceFileId, f.relative_path AS relativePath,
      e.source_type AS sourceType, e.canon_status AS canonStatus,
      e.confidence, e.review_status AS reviewStatus,
      e.classification_reason AS classificationReason
    FROM entities e JOIN source_files f ON f.source_file_id=e.source_file_id
    WHERE e.retired = 0 AND (? IS NULL OR e.entity_type = ?)
      AND ${retrievalVisibleSql("f")}
    ORDER BY e.entity_type, e.canonical_label LIMIT ?
  `).all(entityType ?? null, entityType ?? null, limit) as Omit<EntityRecord, "aliases">[];
  const aliasQuery = database.prepare("SELECT alias_text FROM entity_aliases WHERE entity_id=? ORDER BY normalized_alias");
  return rows.map((row) => ({ ...row, aliases: (aliasQuery.all(row.entityId) as Array<{ alias_text: string }>).map((alias) => alias.alias_text) }));
}

export function entityDuplicateCandidates(database: FeatherDatabase, limit = 50): object[] {
  return database.prepare(`
    SELECT d.candidate_id AS candidateId, d.match_kind AS matchKind,
      d.score, d.reason, d.review_status AS reviewStatus,
      left_entity.entity_id AS leftEntityId, left_entity.canonical_label AS leftLabel,
      left_file.relative_path AS leftPath,
      right_entity.entity_id AS rightEntityId, right_entity.canonical_label AS rightLabel,
      right_file.relative_path AS rightPath
    FROM entity_duplicate_candidates d
    JOIN entities left_entity ON left_entity.entity_id=d.left_entity_id
    JOIN source_files left_file ON left_file.source_file_id=left_entity.source_file_id
    JOIN entities right_entity ON right_entity.entity_id=d.right_entity_id
    JOIN source_files right_file ON right_file.source_file_id=right_entity.source_file_id
    WHERE d.review_status='pending'
    ORDER BY d.score DESC, leftLabel, rightLabel LIMIT ?
  `).all(limit) as object[];
}
