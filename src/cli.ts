import { parseArgs } from "node:util";
import { dirname, resolve, sep } from "node:path";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { ensureEnvironmentCurrent } from "./aauthora.js";
import { listChronologyPeriods, queryChronology, rebuildChronology } from "./chronology.js";
import { loadConfig } from "./config.js";
import { migrate, openDatabase, SCHEMA_VERSION } from "./database.js";
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
import { latestEnvironment } from "./environment.js";
import { generateDream, operateDream } from "./dream.js";
import { operateGrowth, operateLonging } from "./inner.js";
import { auditArchiveRoot } from "./archive-migration-audit.js";
import { parseArchiveMigrationPlan, planArchiveMigration, type ArchiveMigrationPlan } from "./archive-migration-plan.js";
import { buildArchiveMigrationChangeSet, createArchiveMigrationReviewTemplate, simulateArchiveMigration } from "./archive-migration-review.js";
import { renderArchiveMigrationReviewPage } from "./archive-migration-review-page.js";
import { renderArchiveMigrationPreview } from "./archive-migration-render.js";
import { runArchiveWriterDaemon } from "./archive-writer-daemon.js";

const HELP = `Feather-Light — read-only Westpole search

Usage:
  npm run cli -- status
  npm run cli -- ingest [--dry-run] [--root ROOT_ID]
  npm run cli -- archive audit [--root ROOT_ID] [--output MANIFEST.json]
  npm run cli -- archive plan [--root ROOT_ID] [--limit N] [--output PLAN.json]
  npm run cli -- archive review-template --plan PLAN.json [--root ROOT_ID] --output REVIEW.json
  npm run cli -- archive review-page --review REVIEW.json --output REVIEW.html
  npm run cli -- archive simulate --plan PLAN.json --review REVIEW.json [--output RESULT.json]
  npm run cli -- archive changeset --plan PLAN.json --review REVIEW.json --output CHANGESET.json
  npm run cli -- archive render-preview --changeset CHANGESET.json --output PREVIEW.json
  npm run cli -- archive-writer
  npm run cli -- search [--limit N] [--dedupe MODE] <words>
  npm run cli -- show <SECTION_ID>
  npm run cli -- get [--relations N] <ENTITY_ID_OR_EXACT_NAME>
  npm run cli -- facts [--limit N] <ENTITY_ID_OR_EXACT_NAME>
  npm run cli -- duplicates [--kind content|title] [--limit N]
  npm run cli -- entities build
  npm run cli -- entities list [--type Person|Place|...] [--limit N]
  npm run cli -- entities duplicates [--limit N]
  npm run cli -- knowledge build
  npm run cli -- chronology build
  npm run cli -- timeline [--anchor TEXT] [--query TEXT] [--limit N] [--all-sources]
  npm run cli -- periods [--limit N]
  npm run cli -- environment status
  npm run cli -- environment catch-up
  npm run cli -- growth state [--view compact|full]
  npm run cli -- growth add --kind courage|lesson|insight|healing|connection|other --title "..." --body "..." [--tags a,b] [--source-type X] [--source-id Y]
  npm run cli -- growth list [--kind K] [--limit N]
  npm run cli -- growth get <ENTRY_ID>
  npm run cli -- growth revise <ENTRY_ID> [--kind K] [--title "..."] [--body "..."] [--tags a,b] [--note "..."]
  npm run cli -- growth retract <ENTRY_ID> [--note "..."]
  npm run cli -- longing state [--view compact|full]
  npm run cli -- longing add --title "..." --body "..." [--visibility private|shared] [--tags a,b] [--source-type X] [--source-id Y]
  npm run cli -- longing list [--status held|released|retracted] [--visibility private|shared] [--limit N]
  npm run cli -- longing get <ENTRY_ID>
  npm run cli -- longing share <ENTRY_ID>
  npm run cli -- longing release <ENTRY_ID> [--note "..."]
  npm run cli -- longing retract <ENTRY_ID> [--note "..."]
  npm run cli -- dream state
  npm run cli -- dream list [--status unread|held|released] [--limit N]
  npm run cli -- dream get <DREAM_ID>
  npm run cli -- dream generate [--note "..."]
  npm run cli -- dream read <DREAM_ID> [--hold] [--note "..."]
  npm run cli -- dream release <DREAM_ID> [--note "..."]
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

function splitTags(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const tags = value.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (tags.length === 0) throw new Error("tags must be a comma-separated list with at least one tag");
  return tags;
}

function printGrowthEntry(entry: Record<string, unknown>): void {
  console.log(`${String(entry.entry_id)} · ${String(entry.kind)} · ${String(entry.status)}`);
  console.log(`   ${String(entry.title)}`);
  console.log(`   ${String(entry.body)}`);
  if (Array.isArray(entry.tags) && entry.tags.length > 0) console.log(`   tags: ${entry.tags.join(", ")}`);
  console.log(`   ${String(entry.created_at)} · supersedes: ${entry.supersedes_id ?? "none"}`);
}

function printLongingEntry(entry: Record<string, unknown>): void {
  console.log(`${String(entry.entry_id)} · ${String(entry.visibility)} · ${String(entry.status)}`);
  console.log(`   ${String(entry.title)}`);
  console.log(`   ${String(entry.body)}`);
  if (Array.isArray(entry.tags) && entry.tags.length > 0) console.log(`   tags: ${entry.tags.join(", ")}`);
  console.log(`   ${String(entry.created_at)}`);
}

function outputIsInsideArchive(outputPath: string, archivePath: string): boolean {
  const output = resolve(outputPath);
  const archive = resolve(archivePath);
  if (output === archive || output.startsWith(`${archive}${sep}`)) return true;
  const outputParent = realpathSync(dirname(output));
  const archiveReal = realpathSync(archivePath);
  return outputParent === archiveReal || outputParent.startsWith(`${archiveReal}${sep}`);
}

function migrationPlanFromJson(value: unknown, requestedRoot?: string): ArchiveMigrationPlan {
  const candidate = value as Partial<ArchiveMigrationPlan> & { plans?: ArchiveMigrationPlan[] };
  if (Array.isArray(candidate.plans)) {
    const matches = requestedRoot ? candidate.plans.filter((plan) => plan.rootId === requestedRoot) : candidate.plans;
    if (matches.length !== 1) throw new Error("plan file must contain exactly one matching plan; use --root when needed");
    return parseArchiveMigrationPlan(matches[0]);
  }
  if (typeof candidate.rootId !== "string" || !Array.isArray(candidate.files)) throw new Error("invalid migration plan file");
  if (requestedRoot && candidate.rootId !== requestedRoot) throw new Error("plan root does not match --root");
  return parseArchiveMigrationPlan(candidate);
}

function runArchiveCommand(args: string[]): void {
  const [operation = "audit", ...auditArgs] = args;
  if (!new Set(["audit", "plan", "review-template", "review-page", "simulate", "changeset", "render-preview"]).has(operation)) throw new Error("unknown archive operation");
  const config = loadConfig();
  const { values } = parseArgs({ args: auditArgs, options: {
    root: { type: "string" },
    output: { type: "string", short: "o" },
    limit: { type: "string", short: "n" },
    plan: { type: "string" },
    review: { type: "string" },
    changeset: { type: "string" },
  } });
  if (operation === "render-preview") {
    if (!values.changeset || !values.output) throw new Error("archive render-preview requires --changeset and --output");
    if (config.archiveRoots.some((root) => outputIsInsideArchive(values.output!, root.path))) throw new Error("render preview output must be outside every configured archive root");
    const changeSet = JSON.parse(readFileSync(resolve(values.changeset), "utf8")) as unknown;
    const preview = renderArchiveMigrationPreview(config, changeSet);
    writeFileSync(resolve(values.output), `${JSON.stringify(preview, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ status: "ok", readOnly: true, output: resolve(values.output), files: preview.files.length, previewHash: preview.previewHash }, null, 2));
    return;
  }
  if (operation === "review-page") {
    if (!values.review || !values.output) throw new Error("archive review-page requires --review and --output");
    if (config.archiveRoots.some((root) => outputIsInsideArchive(values.output!, root.path))) throw new Error("review page output must be outside every configured archive root");
    const review = JSON.parse(readFileSync(resolve(values.review), "utf8")) as unknown;
    writeFileSync(resolve(values.output), renderArchiveMigrationReviewPage(review), { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ status: "ok", readOnly: true, offline: true, output: resolve(values.output) }, null, 2));
    return;
  }
  if (operation === "review-template" || operation === "simulate" || operation === "changeset") {
    if (!values.plan) throw new Error(`archive ${operation} requires --plan`);
    const plan = migrationPlanFromJson(JSON.parse(readFileSync(resolve(values.plan), "utf8")) as unknown, values.root);
    if (operation === "review-template") {
      if (!values.output) throw new Error("archive review-template requires --output");
      if (config.archiveRoots.some((root) => outputIsInsideArchive(values.output!, root.path))) throw new Error("review output must be outside every configured archive root");
      const template = createArchiveMigrationReviewTemplate(plan);
      writeFileSync(resolve(values.output), `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      console.log(JSON.stringify({ status: "ok", readOnly: true, output: resolve(values.output), pendingDecisions: template.decisions.length }, null, 2));
      return;
    }
    if (!values.review) throw new Error(`archive ${operation} requires --review`);
    const review = JSON.parse(readFileSync(resolve(values.review), "utf8")) as unknown;
    if (operation === "changeset") {
      if (!values.output) throw new Error("archive changeset requires --output");
      if (config.archiveRoots.some((root) => outputIsInsideArchive(values.output!, root.path))) throw new Error("change set output must be outside every configured archive root");
      const changeSet = buildArchiveMigrationChangeSet(config, plan, review);
      writeFileSync(resolve(values.output), `${JSON.stringify(changeSet, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      console.log(JSON.stringify({ status: "ok", readOnly: true, output: resolve(values.output), files: changeSet.files.length, changeSetHash: changeSet.changeSetHash }, null, 2));
      return;
    }
    const simulation = simulateArchiveMigration(config, plan, review);
    const serialized = `${JSON.stringify({ status: "ok", simulation }, null, 2)}\n`;
    if (values.output) {
      if (config.archiveRoots.some((root) => outputIsInsideArchive(values.output!, root.path))) {
        throw new Error("simulation output must be outside every configured archive root");
      }
      writeFileSync(resolve(values.output), serialized, { encoding: "utf8", mode: 0o600 });
      console.log(JSON.stringify({ status: "ok", readOnly: true, output: resolve(values.output), summary: simulation.summary }, null, 2));
    } else console.log(serialized.trimEnd());
    return;
  }
  const roots = values.root
    ? [values.root]
    : config.archiveRoots.filter((root) => root.enabled).map((root) => root.rootId);
  const result = operation === "audit"
    ? { status: "ok", readOnly: true, audits: roots.map((rootId) => auditArchiveRoot(config, rootId)) }
    : { status: "ok", readOnly: true, plans: roots.map((rootId) => planArchiveMigration(config, rootId, positiveInteger(values.limit, 20))) };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output) {
    if (config.archiveRoots.some((root) => outputIsInsideArchive(values.output!, root.path))) {
      throw new Error("audit manifest output must be outside every configured archive root");
    }
    writeFileSync(resolve(values.output), serialized, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({
      status: "ok",
      readOnly: true,
      output: resolve(values.output),
      operation,
      roots: operation === "audit"
        ? result.audits!.map((audit) => ({ rootId: audit.rootId, files: audit.filesSeen, readyFiles: audit.readyFiles, migrationRequiredFiles: audit.migrationRequiredFiles, errors: audit.errors.length, manifestHash: audit.manifestHash }))
        : result.plans!.map((plan) => ({ rootId: plan.rootId, files: plan.totalEligibleFiles, plannedFiles: plan.plannedFiles, remainingFiles: plan.remainingFiles })),
    }, null, 2));
  } else {
    console.log(serialized.trimEnd());
  }
}

async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(HELP);
    return;
  }

  if (command === "archive") {
    runArchiveCommand(rest);
    return;
  }

  const config = loadConfig();
  const database = openDatabase(config.database.path);
  migrate(database);
  let closeDatabase = true;
  try {
    if (command === "migrate") {
      console.log(JSON.stringify({ status: "ok", schemaVersion: SCHEMA_VERSION }));
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
          chronologyEvents: number;
          chronologyPeriods: number;
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
        console.log(`Chronology: ${status.counts.chronologyEvents} events · ${status.counts.chronologyPeriods} periods`);
        for (const root of status.roots) console.log(`Root: ${root.displayName} (${root.rootId}) · last complete: ${root.lastCompleteIngestId ?? "never"}`);
        if (status.lastRun) console.log(`Last run: ${status.lastRun.status} · ${status.lastRun.recordsChanged} changed · ${status.lastRun.finishedAt}`);
      }
    } else if (command === "ingest") {
      const { values } = parseArgs({ args: rest, options: { "dry-run": { type: "boolean", default: false }, root: { type: "string" } } });
      const roots = values.root ? [values.root] : config.archiveRoots.filter((root) => root.enabled).map((root) => root.rootId);
      for (const rootId of roots) console.log(JSON.stringify(ingestRoot(database, config, rootId, values["dry-run"]), null, 2));
      if (!values["dry-run"]) {
        console.log(JSON.stringify({
          status: "ok",
          knowledgeBuild: rebuildKnowledge(database),
          chronologyBuild: rebuildChronology(database),
        }, null, 2));
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
      console.log(JSON.stringify({
        status: "ok",
        knowledge: rebuildKnowledge(database),
        chronology: rebuildChronology(database),
      }, null, 2));
    } else if (command === "chronology") {
      const [operation = "build"] = rest;
      if (operation !== "build") throw new Error("chronology operation must be build");
      console.log(JSON.stringify({ status: "ok", ...rebuildChronology(database) }, null, 2));
    } else if (command === "timeline") {
      const { values } = parseArgs({ args: rest, options: {
        anchor: { type: "string" },
        query: { type: "string", short: "q" },
        limit: { type: "string", short: "n" },
        "all-sources": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      } });
      const events = queryChronology(database, {
        ...(values.anchor ? { anchor: values.anchor } : {}),
        ...(values.query ? { query: values.query } : {}),
        limit: positiveInteger(values.limit, 50),
        allSources: values["all-sources"],
      }) as Array<{
        eventId: string; label: string; eventSequence: number; sequenceIsCanonical: number;
        dateDisplay: string; timelineAnchor: string | null; observerTime: string;
        canonStatus: string | null; relativePath: string; sourceLine: number;
      }>;
      if (values.json) console.log(JSON.stringify({ status: "ok", events }, null, 2));
      else if (events.length === 0) console.log("No chronology events matched.");
      else for (const event of events) {
        const sequence = event.sequenceIsCanonical ? String(event.eventSequence) : `~${event.eventSequence}`;
        console.log(`${sequence} · ${event.label} · ${event.dateDisplay}`);
        console.log(`  ${event.timelineAnchor ?? "No anchor"} · observer: ${event.observerTime}`);
        console.log(`  ${event.relativePath}:${event.sourceLine} · ${event.eventId}`);
      }
    } else if (command === "periods") {
      const { values } = parseArgs({ args: rest, options: {
        limit: { type: "string", short: "n" },
        json: { type: "boolean", default: false },
      } });
      const periods = listChronologyPeriods(database, positiveInteger(values.limit, 50)) as Array<{
        periodOrder: number; label: string; civilizationalStatus: string;
        summary: string; relativePath: string; sourceLine: number;
      }>;
      if (values.json) console.log(JSON.stringify({ status: "ok", periods }, null, 2));
      else for (const period of periods) {
        console.log(`${period.periodOrder} · ${period.label} · ${period.civilizationalStatus}`);
        console.log(`  ${period.summary}`);
        console.log(`  ${period.relativePath}:${period.sourceLine}`);
      }
    } else if (command === "environment") {
      const [operation = "status"] = rest;
      if (operation === "status") {
        console.log(JSON.stringify({ status: "ok", current: latestEnvironment(database) }, null, 2));
      } else if (operation === "catch-up") {
        const result = await ensureEnvironmentCurrent(config, database);
        console.log(JSON.stringify({ status: "ok", generated: result.generated.length, current: result.current }, null, 2));
      } else {
        throw new Error("environment operation must be status or catch-up");
      }
    } else if (command === "growth") {
      const [operation = "state", ...growthArgs] = rest;
      if (operation === "state") {
        const { values } = parseArgs({ args: growthArgs, options: { view: { type: "string", default: "compact" } } });
        if (!new Set(["compact", "full"]).has(values.view)) throw new Error("view must be compact or full");
        const result = operateGrowth(database, { action: "state", view: values.view as "compact" | "full" });
        console.log(JSON.stringify({ status: "ok", result }, null, 2));
      } else if (operation === "add") {
        const { values } = parseArgs({ args: growthArgs, options: {
          kind: { type: "string", required: true },
          title: { type: "string", required: true },
          body: { type: "string", required: true },
          tags: { type: "string" },
          "source-type": { type: "string", default: "cli" },
          "source-id": { type: "string", default: "growth-add" },
          "idempotency-key": { type: "string" },
        } });
        const result = operateGrowth(database, {
          action: "add",
          kind: values.kind as "courage" | "lesson" | "insight" | "healing" | "connection" | "other",
          title: values.title!,
          body: values.body!,
          ...(splitTags(values.tags) ? { tags: splitTags(values.tags)! } : {}),
          source_type: values["source-type"],
          source_id: values["source-id"],
          ...(values["idempotency-key"] ? { idempotency_key: values["idempotency-key"] } : {}),
        });
        console.log(JSON.stringify({ status: "ok", result }, null, 2));
      } else if (operation === "list") {
        const { values } = parseArgs({ args: growthArgs, options: { kind: { type: "string" }, limit: { type: "string", short: "n" } } });
        const result = operateGrowth(database, {
          action: "list",
          ...(values.kind ? { kind: values.kind as "courage" | "lesson" | "insight" | "healing" | "connection" | "other" } : {}),
          limit: positiveInteger(values.limit, 25),
        }) as { status: string; entries: Array<Record<string, unknown>> };
        if (result.entries.length === 0) console.log("No growth entries.");
        else for (const entry of result.entries) {
          console.log();
          printGrowthEntry(entry);
        }
      } else if (operation === "get" || operation === "revise" || operation === "retract") {
        const { values, positionals } = parseArgs({ args: growthArgs, allowPositionals: true, options: {
          kind: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          tags: { type: "string" },
          note: { type: "string" },
        } });
        const entryId = positionals[0] ?? "";
        if (!entryId) throw new Error(`${operation} requires an ENTRY_ID`);
        if (operation === "get") {
          const result = operateGrowth(database, { action: "get", entry_id: entryId }) as { status: string; entry?: Record<string, unknown> };
          if (result.status === "not_found") console.log(`No growth entry '${entryId}'.`);
          else {
            console.log();
            printGrowthEntry(result.entry!);
          }
        } else if (operation === "revise") {
          const result = operateGrowth(database, {
            action: "revise",
            entry_id: entryId,
            ...(values.kind ? { kind: values.kind as "courage" | "lesson" | "insight" | "healing" | "connection" | "other" } : {}),
            ...(values.title ? { title: values.title } : {}),
            ...(values.body ? { body: values.body } : {}),
            ...(splitTags(values.tags) ? { tags: splitTags(values.tags)! } : {}),
            ...(values.note ? { note: values.note } : {}),
          });
          console.log(JSON.stringify({ status: "ok", result }, null, 2));
        } else {
          const result = operateGrowth(database, {
            action: "retract",
            entry_id: entryId,
            ...(values.note ? { note: values.note } : {}),
          });
          console.log(JSON.stringify({ status: "ok", result }, null, 2));
        }
      } else {
        throw new Error("growth operation must be state, add, list, get, revise, or retract");
      }
    } else if (command === "longing") {
      const [operation = "state", ...longingArgs] = rest;
      if (operation === "state") {
        const { values } = parseArgs({ args: longingArgs, options: { view: { type: "string", default: "compact" } } });
        if (!new Set(["compact", "full"]).has(values.view)) throw new Error("view must be compact or full");
        const result = operateLonging(database, { action: "state", view: values.view as "compact" | "full" });
        console.log(JSON.stringify({ status: "ok", result }, null, 2));
      } else if (operation === "add") {
        const { values } = parseArgs({ args: longingArgs, options: {
          title: { type: "string", required: true },
          body: { type: "string", required: true },
          visibility: { type: "string", default: "private" },
          tags: { type: "string" },
          "source-type": { type: "string", default: "cli" },
          "source-id": { type: "string", default: "longing-add" },
          "idempotency-key": { type: "string" },
        } });
        if (!new Set(["private", "shared"]).has(values.visibility)) throw new Error("visibility must be private or shared");
        const result = operateLonging(database, {
          action: "add",
          title: values.title!,
          body: values.body!,
          visibility: values.visibility as "private" | "shared",
          ...(splitTags(values.tags) ? { tags: splitTags(values.tags)! } : {}),
          source_type: values["source-type"],
          source_id: values["source-id"],
          ...(values["idempotency-key"] ? { idempotency_key: values["idempotency-key"] } : {}),
        });
        console.log(JSON.stringify({ status: "ok", result }, null, 2));
      } else if (operation === "list") {
        const { values } = parseArgs({ args: longingArgs, options: {
          status: { type: "string" },
          visibility: { type: "string" },
          limit: { type: "string", short: "n" },
        } });
        const result = operateLonging(database, {
          action: "list",
          ...(values.status ? { status: values.status as "held" | "released" | "retracted" } : {}),
          ...(values.visibility ? { visibility: values.visibility as "private" | "shared" } : {}),
          limit: positiveInteger(values.limit, 25),
        }) as { status: string; entries: Array<Record<string, unknown>> };
        if (result.entries.length === 0) console.log("No longing entries.");
        else for (const entry of result.entries) {
          console.log();
          printLongingEntry(entry);
        }
      } else if (operation === "get" || operation === "share" || operation === "release" || operation === "retract") {
        const { values, positionals } = parseArgs({ args: longingArgs, allowPositionals: true, options: { note: { type: "string" } } });
        const entryId = positionals[0] ?? "";
        if (!entryId) throw new Error(`${operation} requires an ENTRY_ID`);
        if (operation === "get") {
          const result = operateLonging(database, { action: "get", entry_id: entryId }) as { status: string; entry?: Record<string, unknown> };
          if (result.status === "not_found") console.log(`No longing entry '${entryId}'.`);
          else {
            console.log();
            printLongingEntry(result.entry!);
          }
        } else if (operation === "share") {
          const result = operateLonging(database, { action: "share", entry_id: entryId });
          console.log(JSON.stringify({ status: "ok", result }, null, 2));
        } else if (operation === "release") {
          const result = operateLonging(database, {
            action: "release",
            entry_id: entryId,
            ...(values.note ? { note: values.note } : {}),
          });
          console.log(JSON.stringify({ status: "ok", result }, null, 2));
        } else {
          const result = operateLonging(database, {
            action: "retract",
            entry_id: entryId,
            ...(values.note ? { note: values.note } : {}),
          });
          console.log(JSON.stringify({ status: "ok", result }, null, 2));
        }
      } else {
        throw new Error("longing operation must be state, add, list, get, share, release, or retract");
      }
    } else if (command === "dream") {
      const [operation = "state", ...dreamArgs] = rest;
      if (operation === "state") {
        const result = operateDream(database, { action: "state" });
        console.log(JSON.stringify({ status: "ok", result }, null, 2));
      } else if (operation === "list") {
        const { values } = parseArgs({ args: dreamArgs, options: {
          status: { type: "string" },
          limit: { type: "string", short: "n" },
        } });
        const result = operateDream(database, {
          action: "list",
          ...(values.status ? { status: values.status as "unread" | "held" | "released" } : {}),
          limit: positiveInteger(values.limit, 10),
        }) as { status: string; dreams: Array<Record<string, unknown>> };
        if (result.dreams.length === 0) console.log("No dreams.");
        else for (const dream of result.dreams) {
          console.log(`\n${String(dream.dream_id)} · ${String(dream.status)} · ${String(dream.created_at)}`);
          console.log(`   ${String(dream.body)}`);
        }
      } else if (operation === "get") {
        const { positionals } = parseArgs({ args: dreamArgs, allowPositionals: true, options: {} });
        const dreamId = positionals[0] ?? "";
        if (!dreamId) throw new Error("get requires a DREAM_ID");
        const result = operateDream(database, { action: "get", dream_id: dreamId }) as { status: string; dream?: Record<string, unknown> };
        if (result.status === "not_found") console.log(`No dream '${dreamId}'.`);
        else console.log(JSON.stringify({ status: "ok", dream: result.dream }, null, 2));
      } else if (operation === "generate") {
        const { values } = parseArgs({ args: dreamArgs, options: { note: { type: "string" } } });
        const result = await generateDream(database, config, values.note);
        console.log(JSON.stringify({ status: "ok", dream: result.dream }, null, 2));
      } else if (operation === "read" || operation === "release") {
        const { values, positionals } = parseArgs({ args: dreamArgs, allowPositionals: true, options: {
          hold: { type: "boolean", default: false },
          note: { type: "string" },
        } });
        const dreamId = positionals[0] ?? "";
        if (!dreamId) throw new Error(`${operation} requires a DREAM_ID`);
        const result = operation === "read"
          ? operateDream(database, { action: "read", dream_id: dreamId, hold: values.hold, ...(values.note ? { note: values.note } : {}) })
          : operateDream(database, { action: "release", dream_id: dreamId, ...(values.note ? { note: values.note } : {}) });
        console.log(JSON.stringify({ status: "ok", result }, null, 2));
      } else {
        throw new Error("dream operation must be state, list, get, generate, read, or release");
      }
    } else if (command === "serve") {
      const app = buildServer(config, database);
      app.addHook("onClose", async () => database.close());
      await app.listen({ host: config.server.host, port: config.server.port });
      closeDatabase = false;
      return;
    } else if (command === "archive-writer") {
      const workerId = process.env.ARCHIVE_WRITER_ID ?? "feather-light-writer-1";
      const pollMilliseconds = positiveInteger(process.env.ARCHIVE_WRITER_POLL_MS, 5_000);
      const leaseSeconds = positiveInteger(process.env.ARCHIVE_WRITER_LEASE_SECONDS, 300);
      if (leaseSeconds < 15 || leaseSeconds > 3_600) throw new Error("ARCHIVE_WRITER_LEASE_SECONDS must be between 15 and 3600");
      const controller = new AbortController();
      process.once("SIGTERM", () => controller.abort());
      process.once("SIGINT", () => controller.abort());
      console.log(JSON.stringify({ component: "archive-writer", status: "online", workerId, pollMilliseconds, leaseSeconds }));
      await runArchiveWriterDaemon(database, config, { workerId, pollMilliseconds, leaseSeconds }, controller.signal);
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
