import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./database.js";
import { ingestRoot } from "./ingest.js";
import { search } from "./search.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const config = loadConfig();
  const database = openDatabase(config.database.path);
  migrate(database);
  if (command === "migrate") {
    console.log(JSON.stringify({ status: "ok", schemaVersion: 1 }));
  } else if (command === "ingest") {
    const { values } = parseArgs({ args: rest, options: { "dry-run": { type: "boolean", default: false }, root: { type: "string" } } });
    const roots = values.root ? [values.root] : config.archiveRoots.filter((root) => root.enabled).map((root) => root.rootId);
    for (const rootId of roots) console.log(JSON.stringify(ingestRoot(database, config, rootId, values["dry-run"]), null, 2));
  } else if (command === "search") {
    const query = rest.join(" ").trim();
    console.log(JSON.stringify({ status: "ok", results: search(database, config, query) }, null, 2));
  } else if (command === "serve") {
    const app = buildServer(config, database);
    await app.listen({ host: config.server.host, port: config.server.port });
    return;
  } else {
    throw new Error("usage: feather-light <migrate|ingest|search|serve>");
  }
  database.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

