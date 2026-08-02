import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./database.js";
import { findDuplicates, type DuplicateKind } from "./duplicates.js";
import { getSection } from "./evidence.js";
import { ingestRoot } from "./ingest.js";
import { search, type DedupeMode, type SearchResult } from "./search.js";
import { buildServer } from "./server.js";
import { indexStatus } from "./status.js";

const HELP = `Feather-Light — read-only Westpole search

Usage:
  npm run cli -- status
  npm run cli -- ingest [--dry-run] [--root ROOT_ID]
  npm run cli -- search [--limit N] [--dedupe MODE] <words>
  npm run cli -- show <SECTION_ID>
  npm run cli -- duplicates [--kind content|title] [--limit N]
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
      console.log(JSON.stringify({ status: "ok", schemaVersion: 1 }));
    } else if (command === "status") {
      const { values } = parseArgs({ args: rest, options: { json: { type: "boolean", default: false } } });
      const status = indexStatus(database) as {
        status: string;
        counts: { sourceFiles: number; sourceSections: number; wikilinks: number };
        roots: Array<{ rootId: string; displayName: string; lastCompleteIngestId: string | null }>;
        lastRun: { status: string; recordsChanged: number; finishedAt: string } | null;
      };
      if (values.json) console.log(JSON.stringify(status, null, 2));
      else {
        console.log(`Index: ${status.status}`);
        console.log(`Files: ${status.counts.sourceFiles} · Sections: ${status.counts.sourceSections} · Wikilinks: ${status.counts.wikilinks}`);
        for (const root of status.roots) console.log(`Root: ${root.displayName} (${root.rootId}) · last complete: ${root.lastCompleteIngestId ?? "never"}`);
        if (status.lastRun) console.log(`Last run: ${status.lastRun.status} · ${status.lastRun.recordsChanged} changed · ${status.lastRun.finishedAt}`);
      }
    } else if (command === "ingest") {
      const { values } = parseArgs({ args: rest, options: { "dry-run": { type: "boolean", default: false }, root: { type: "string" } } });
      const roots = values.root ? [values.root] : config.archiveRoots.filter((root) => root.enabled).map((root) => root.rootId);
      for (const rootId of roots) console.log(JSON.stringify(ingestRoot(database, config, rootId, values["dry-run"]), null, 2));
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
