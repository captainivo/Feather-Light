import Fastify from "fastify";
import { z } from "zod";
import { queryChronology } from "./chronology.js";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { getEntityAssertions, getEntityBrief } from "./knowledge.js";
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
  const querySchema = z.discriminatedUnion("operation", [
    z.object({
      operation: z.literal("search"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(config.limits.searchResults).default(5),
      dedupe: z.enum(["none", "file", "title", "content"]).default("file"),
    }),
    z.object({
      operation: z.literal("get"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    z.object({
      operation: z.literal("facts"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    z.object({
      operation: z.literal("timeline"),
      query: z.string().max(500).optional(),
      anchor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      allSources: z.boolean().default(false),
    }),
    z.object({ operation: z.literal("status") }),
  ]);
  app.post("/v1/query", async (request, reply) => {
    const parsed = querySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    }
    const input = parsed.data;
    if (input.operation === "status") return indexStatus(database);
    if (input.operation === "search") {
      return {
        status: "ok",
        results: search(database, config, input.query, {
          limit: input.limit,
          dedupe: input.dedupe,
        }),
      };
    }
    if (input.operation === "get") return getEntityBrief(database, input.query, input.limit);
    if (input.operation === "facts") return getEntityAssertions(database, input.query, input.limit);
    return {
      status: "ok",
      events: queryChronology(database, {
        ...(input.query ? { query: input.query } : {}),
        ...(input.anchor ? { anchor: input.anchor } : {}),
        limit: input.limit,
        allSources: input.allSources,
      }),
    };
  });
  return app;
}
