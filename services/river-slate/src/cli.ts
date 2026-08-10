import { loadConfig } from "./config.js";
import { openReadonly } from "./db.js";
import { buildHealthCard } from "./health-card/build.js";
import { buildServer } from "./server.js";

const HELP = `River-Slate — Mithra's digest API and health card

Usage:
  npm run start               start the server (built)
  npm run dev                 start with tsx watch
  npm run cli -- health-card  build health_card.json + html (same as the timer)
  node dist/src/cli.js serve  same entrypoint a container will use

Commands:
  serve                      start the digest API server
  health-card                rebuild the health card data + dashboard

Environment:
  RIVER_SLATE_PORT         listen port (default 8422)
  RIVER_SLATE_BIND         bind address (default 127.0.0.1)
  HEALTH_CARD_DIR          directory with health_card.json + self_audit.json
  FEATHER_LIGHT_DB         path to the read-only state database
  AUTHORA_API_BASE_URL     Aauthora current-conditions API (default http://127.0.0.1:8421)
  TELEMETRY_DB             optional private usage database (internal only)`;

export async function main(): Promise<void> {
  const [command = "serve"] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(HELP);
    return;
  }

  const config = loadConfig();

  if (command === "health-card") {
    const database = openReadonly(config.featherLightDb);
    try {
      const result = await buildHealthCard(config, database);
      console.log(`Health card built at ${config.healthCardDir}`);
      console.log(`  api: ${result.apiAvailable ? "current" : "unavailable (DB-only view)"}`);
      console.log(`  snapshot: ${result.snapshotAppended ? "appended" : "unchanged"}`);
      console.log(`  wrote: ${result.wrote.join(", ")}`);
      console.log("Lights:");
      for (const [key, light] of Object.entries(result.lights)) {
        console.log(`  ${key.padEnd(18)} ${light.level.padEnd(8)} ${light.note}`);
      }
    } finally {
      database.close();
    }
    return;
  }

  if (command !== "serve") {
    throw new Error(`unknown command: ${command}`);
  }

  const database = openReadonly(config.featherLightDb);
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

