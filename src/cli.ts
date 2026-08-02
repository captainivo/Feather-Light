import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./database.js";
import { findDuplicates, type DuplicateKind } from "./duplicates.js";
import {
  entityDuplicateCandidates,
  type EntityRecord,
  type EntityType,
  listEntities,
  rebuildEntities,
} from "./entities.js";
import { getSection } from "./evidence.js";
import { ingestRoot } from "./ingest.js";
import { getEntityAssertions, getEntityBrief, rebuildKnowledge } from "./knowledge.js";
import { search, type DedupeMode, type SearchResult } from "./search.js";
import { buildServer } from "./server.js";
import { indexStatus } from "./status.js";

const HELP = `Feather-Light — read-only Westpole search

Usage:
  npm run cli -- status
  npm run cli -- ingest [--dry-run] [--root ROOT_ID]
  npm run cli -- search [--limit N] [--dedupe MODE] <words>
  npm run cli -- show <SECTION_ID>
  npm run cli -- get [--relations N] <ENTITY_ID_OR_EXACT_NAME>
  npm run cli -- facts [--limit N] <ENTITY_ID_OR_EXACT_NAME>
  npm run cli -- duplicates [--kind content|title] [--limit N]
  npm run cli -- entities build
  npm run cli -- entities list [--type Person|Place|...] [--limit N]
  npm run cli -- entities duplicates [--limit N]
  npm run cli -- knowledge build
  npm run cli -- serve

Search deduplication modes:
  file      one best section per source file (default)
  title     one best result per normalized title
  content   one best result per identical source-file hash
  none      return matching sections without deduplication

Add --json to status, search, show, or duplicates for machine-readable output.`;

function printSearchResults(results: SearchResult[]): void {
  if (results.length === 0) {
    console.log("No matches.");
    return;
  }
  for (const [index, result] of results.entries()) {
    console.log(`\n${index + 1}. ${result.title}`);
    console.log(`   ${result.relativePath} · ${result.headingPath} · lines ${result.startLine}-${result.endLine}`);
    console.log(`   section: ${result.sectionId}`);
    const excerpt = result.excerpt.replaceAll(/\s+/g, " ").trim();
    console.log(`   ${excerpt.slice(0, 320)}${excerpt.length > 320 ? "…" : ""}`);
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("limit must be a positive integer");
  return parsed;
}

async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  const database = openDatabase(config.database.path);
  migrate(database);
  let closeDatabase = true;
  try {
    if (command === "migrate") {
      console.log(JSON.stringify({ status: "ok", schemaVersion: 4 }));
    } else if (command === "status") {
      const { values } = parseArgs({ args: rest, options: { json: { type: "boolean", default: false } } });
      const status = indexStatus(database) as {
        status: string;
        counts: {
          sourceFiles: number;
          sourceSections: number;
          wikilinks: number;
          entities: number;
          entityAliases: number;
          entityDuplicateCandidates: number;
          definitions: number;
          relationships: number;
          unresolvedEntityLinks: number;
          assertions: number;
          typedRelationships: number;
        };
        roots: Array<{ rootId: string; displayName: string; lastCompleteIngestId: string | null }>;
        lastRun: { status: string; recordsChanged: number; finishedAt: string } | null;
      };
      if (values.json) console.log(JSON.stringify(status, null, 2));
      else {
        console.log(`Index: ${status.status}`);
        console.log(`Files: ${status.counts.sourceFiles} · Sections: ${status.counts.sourceSections} · Wikilinks: ${status.counts.wikilinks}`);
        console.log(`Entities: ${status.counts.entities} · Aliases: ${status.counts.entityAliases} · Duplicate candidates: ${status.counts.entityDuplicateCandidates}`);
        console.log(`Definitions: ${status.counts.definitions} · Relationships: ${status.counts.relationships} · Unresolved links: ${status.counts.unresolvedEntityLinks}`);
        console.log(`Assertions: ${status.counts.assertions} · Typed relationships: ${status.counts.typedRelationships}`);
        for (const root of status.roots) console.log(`Root: ${root.displayName} (${root.rootId}) · last complete: ${root.lastCompleteIngestId ?? "never"}`);
        if (status.lastRun) console.log(`Last run: ${status.lastRun.status} · ${status.lastRun.recordsChanged} changed · ${status.lastRun.finishedAt}`);
      }
    } else if (command === "ingest") {
      const { values } = parseArgs({ args: rest, options: { "dry-run": { type: "boolean", default: false }, root: { type: "string" } } });
      const roots = values.root ? [values.root] : config.archiveRoots.filter((root) => root.enabled).map((root) => root.rootId);
      for (const rootId of roots) console.log(JSON.stringify(ingestRoot(database, config, rootId, values["dry-run"]), null, 2));
      if (!values["dry-run"]) {
        console.log(JSON.stringify({ status: "ok", knowledgeBuild: rebuildKnowledge(database) }, null, 2));
      }
    } else if (command === "search") {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          limit: { type: "string", short: "n" },
          dedupe: { type: "string", default: "file" },
          json: { type: "boolean", default: false },
        },
      });
      const query = positionals.join(" ").trim();
      const dedupeModes = new Set<DedupeMode>(["none", "file", "title", "content"]);
      if (!dedupeModes.has(values.dedupe as DedupeMode)) throw new Error("dedupe must be none, file, title, or content");
      const results = search(database, config, query, {
        limit: positiveInteger(values.limit, config.limits.searchResults),
        dedupe: values.dedupe as DedupeMode,
      });
      if (values.json) console.log(JSON.stringify({ status: "ok", results }, null, 2));
      else printSearchResults(results);
    } else if (command === "show") {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { json: { type: "boolean", default: false } } });
      const section = getSection(database, positionals[0] ?? "");
      if (!section) throw new Error("section not found");
      if (values.json) console.log(JSON.stringify(section, null, 2));
      else {
        console.log(`${section.title} — ${section.headingPath}`);
        console.log(`${section.relativePath}:${section.startLine}-${section.endLine}`);
        console.log(`section: ${section.sectionId}\n`);
        console.log(section.text);
      }
    } else if (command === "get") {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          relations: { type: "string", short: "n" },
          json: { type: "boolean", default: false },
        },
      });
      const query = positionals.join(" ").trim();
      const result = getEntityBrief(database, query, positiveInteger(values.relations, 10)) as {
        status: string;
        query?: string;
        candidates?: EntityRecord[];
        entity?: EntityRecord;
        definition?: { text: string; kind: string; confidence: number; sourceHeading: string; startLine: number; endLine: number } | null;
        relationships?: Array<{ relationType: string; targetLabel: string; targetType: string }>;
        relationCount?: number;
        truncated?: boolean;
      };
      if (values.json) console.log(JSON.stringify(result, null, 2));
      else if (result.status === "not_found") console.log(`No entity found for '${query}'.`);
      else if (result.status === "ambiguous") {
        console.log(`Ambiguous entity name '${query}':`);
        for (const candidate of result.candidates ?? []) console.log(`  ${candidate.entityId} · ${candidate.entityType} · ${candidate.canonicalLabel} — ${candidate.relativePath}`);
      } else {
        const entity = result.entity!;
        console.log(`${entity.canonicalLabel} · ${entity.entityType} · ${entity.entityId}`);
        console.log(`${entity.relativePath}${entity.aliases.length ? ` · aliases: ${entity.aliases.join(", ")}` : ""}`);
        if (result.definition) {
          console.log(`\n${result.definition.text}`);
          console.log(`\nDefinition: ${result.definition.kind} · ${(result.definition.confidence * 100).toFixed(0)}% · ${result.definition.sourceHeading}:${result.definition.startLine}-${result.definition.endLine}`);
        } else console.log("\nNo definition candidate.");
        if (result.relationships?.length) {
          console.log(`\nDirect relationships (${result.relationCount}${result.truncated ? ", truncated" : ""}):`);
          for (const relationship of result.relationships) console.log(`  ${relationship.relationType} → ${relationship.targetLabel} (${relationship.targetType})`);
        }
      }
    } else if (command === "facts") {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          limit: { type: "string", short: "n" },
          json: { type: "boolean", default: false },
        },
      });
      const query = positionals.join(" ").trim();
      const result = getEntityAssertions(database, query, positiveInteger(values.limit, 25)) as {
        status: string;
        entity?: { canonicalLabel: string; entityType: string };
        assertions?: Array<{
          assertionId: string; claimText: string; knowledgeStatus: string;
          confidence: number; relativePath: string; sourceHeading: string;
          startLine: number; endLine: number;
        }>;
        total?: number;
        truncated?: boolean;
      };
      if (values.json) console.log(JSON.stringify(result, null, 2));
      else if (result.status !== "ok") console.log(`${result.status}: ${query}`);
      else {
        console.log(`${result.entity!.canonicalLabel} · ${result.entity!.entityType} · ${result.total} assertions${result.truncated ? " (truncated)" : ""}`);
        for (const assertion of result.assertions ?? []) {
          console.log(`\n${assertion.assertionId} · ${assertion.knowledgeStatus} · ${(assertion.confidence * 100).toFixed(0)}%`);
          console.log(assertion.claimText);
          console.log(`${assertion.relativePath} · ${assertion.sourceHeading}:${assertion.startLine}-${assertion.endLine}`);
        }
      }
    } else if (command === "duplicates") {
      const { values } = parseArgs({ args: rest, options: {
        kind: { type: "string", default: "content" },
        limit: { type: "string", short: "n" },
        json: { type: "boolean", default: false },
      } });
      if (!new Set(["content", "title"]).has(values.kind)) throw new Error("kind must be content or title");
      const groups = findDuplicates(database, values.kind as DuplicateKind, positiveInteger(values.limit, 25));
      if (values.json) console.log(JSON.stringify({ status: "ok", groups }, null, 2));
      else if (groups.length === 0) console.log(`No duplicate ${values.kind} groups.`);
      else for (const [index, group] of groups.entries()) {
        console.log(`\n${index + 1}. ${group.files.length} files · ${group.kind} · ${group.key}`);
        for (const file of group.files) console.log(`   ${file.title} — ${file.relativePath}`);
      }
    } else if (command === "entities") {
      const [operation = "list", ...entityArgs] = rest;
      if (operation === "build") {
        console.log(JSON.stringify({ status: "ok", ...rebuildEntities(database) }, null, 2));
      } else if (operation === "list") {
        const { values } = parseArgs({ args: entityArgs, options: {
          type: { type: "string" },
          limit: { type: "string", short: "n" },
          json: { type: "boolean", default: false },
        } });
        const allowed = new Set<EntityType>([
          "Person", "Place", "Organization", "Species", "Culture",
          "Civilization", "Artifact", "Technology", "Event", "Concept",
        ]);
        if (values.type && !allowed.has(values.type as EntityType)) throw new Error("unsupported entity type");
        const entities = listEntities(database, values.type as EntityType | undefined, positiveInteger(values.limit, 50));
        if (values.json) console.log(JSON.stringify({ status: "ok", entities }, null, 2));
        else if (entities.length === 0) console.log("No entities.");
        else for (const entity of entities) {
          const review = entity.reviewStatus === "needs_review" ? " · REVIEW" : "";
          console.log(`${entity.entityId} · ${entity.entityType} · ${entity.canonicalLabel}${review}`);
          console.log(`  ${entity.relativePath}${entity.aliases.length ? ` · aliases: ${entity.aliases.join(", ")}` : ""}`);
        }
      } else if (operation === "duplicates") {
        const { values } = parseArgs({ args: entityArgs, options: {
          limit: { type: "string", short: "n" },
          json: { type: "boolean", default: false },
        } });
        const candidates = entityDuplicateCandidates(database, positiveInteger(values.limit, 50));
        if (values.json) console.log(JSON.stringify({ status: "ok", candidates }, null, 2));
        else if (candidates.length === 0) console.log("No pending entity duplicate candidates.");
        else for (const candidate of candidates as Array<{
          candidateId: string; matchKind: string; score: number; reason: string;
          leftLabel: string; leftPath: string; rightLabel: string; rightPath: string;
        }>) {
          console.log(`\n${candidate.candidateId} · ${candidate.matchKind} · ${(candidate.score * 100).toFixed(0)}%`);
          console.log(`  ${candidate.leftLabel} — ${candidate.leftPath}`);
          console.log(`  ${candidate.rightLabel} — ${candidate.rightPath}`);
          console.log(`  ${candidate.reason}`);
        }
      } else {
        throw new Error("entities operation must be build, list, or duplicates");
      }
    } else if (command === "knowledge") {
      const [operation = "build"] = rest;
      if (operation !== "build") throw new Error("knowledge operation must be build");
      console.log(JSON.stringify({ status: "ok", ...rebuildKnowledge(database) }, null, 2));
    } else if (command === "serve") {
      const app = buildServer(config, database);
      app.addHook("onClose", async () => database.close());
      await app.listen({ host: config.server.host, port: config.server.port });
      closeDatabase = false;
      return;
    } else {
      throw new Error(`unknown command: ${command}\n\n${HELP}`);
    }
  } finally {
    if (closeDatabase) database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
