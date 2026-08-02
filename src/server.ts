import Fastify from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { search, type DedupeMode } from "./search.js";
import { indexStatus } from "./status.js";

export function buildServer(config: Config, database: FeatherDatabase) {
  const app = Fastify({ logger: true, bodyLimit: config.limits.responseCharacters });
  app.get("/health", async () => ({ status: "ok", service: "feather-light", version: "0.2.0" }));
  app.get("/v1/status", async () => indexStatus(database));
  app.post("/v1/search", async (request, reply) => {
    const parsed = z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).optional(),
      dedupe: z.enum(["none", "file", "title", "content"]).default("file"),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    try {
      const results = search(database, config, parsed.data.query, {
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
        dedupe: parsed.data.dedupe as DedupeMode,
      });
      return { status: "ok", results, nextCursor: null, truncated: false };
    } catch (error) {
      return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
    }
  });
  return app;
}
