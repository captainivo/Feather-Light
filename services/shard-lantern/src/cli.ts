import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { buildServer } from "./server.js";
import { seedShardDatabaseFromFile } from "./seed.js";

const HELP = `Shard Lantern — the Westpole's inhabitants

Usage:
  npm run start               start the server (built)
  npm run dev                 start with tsx watch
  node dist/src/cli.js serve  same entrypoint a container will use

Environment:
  SHARD_LANTERN_PORT    listen port (default 8423)
  SHARD_LANTERN_BIND    bind address (default 127.0.0.1)
  SHARD_LANTERN_DB      writable database path
  GRANITE_WING_URL      Granite-Wing retrieval API, for the Westpole civil
                        clock (default http://127.0.0.1:8765)
  SHARD_LANTERN_SEED_FILE  optional private JSON seed used only for an empty database`;

export async function main(): Promise<void> {
  const [command = "serve"] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(HELP);
    return;
  }
  if (command !== "serve") {
    throw new Error(`unknown command: ${command}`);
  }

  const config = loadConfig();
  const database = openDb(config.dbPath);
  if (config.seedFile) seedShardDatabaseFromFile(database, config.seedFile);
  const app = buildServer(config, database);

  const shutdown = async (): Promise<void> => {
    await app.close();
    database.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port: config.port, host: config.bind });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
