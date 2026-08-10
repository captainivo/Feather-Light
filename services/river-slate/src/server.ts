import Fastify from "fastify";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./db.js";
import { buildAgencyDigest } from "./digests/agency.js";
import { buildHealthDigest } from "./digests/health.js";
import { buildShelvesDigest } from "./digests/shelves.js";
import { buildStateDigest } from "./digests/state.js";

export function buildServer(config: Config, database: FeatherDatabase) {
  const app = Fastify({ logger: true });

  app.get("/healthz", async () => ({ status: "ok", db: "readonly:ok" }));

  app.get("/api/v1/state", async () => buildStateDigest(config, database));

  app.get("/api/v1/health", async () => buildHealthDigest(config));

  app.get("/api/v1/shelves", async () => buildShelvesDigest(database));

  app.get("/api/v1/agency", async () => buildAgencyDigest(database));

  return app;
}

