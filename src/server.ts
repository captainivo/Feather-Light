import Fastify from "fastify";
import { z } from "zod";
import { currentState, emotionalReflectionSchema, reflectEmotion } from "./aauthora.js";
import { agencyActionSchema, agencyState, operateAgency } from "./agency.js";
import { agencyEnforcementSchema, evaluateAgencyEnforcement } from "./open-hand/enforcement.js";
import { operateRepair, repairActionSchema } from "./open-hand/repair.js";
import { queryChronology } from "./chronology.js";
import { compactAssertionResponse, compactEntityResponse, compactSearchResults, compactTimelineEvents } from "./compact.js";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { getEntityAssertions, getEntityBrief } from "./knowledge.js";
import { search, type DedupeMode } from "./search.js";
import { indexStatus } from "./status.js";

const responseView = z.enum(["brief", "standard"]).default("brief");

export function buildServer(config: Config, database: FeatherDatabase) {
  const app = Fastify({ logger: true, bodyLimit: config.limits.responseCharacters });
  app.get("/health", async () => ({ status: "ok", service: "feather-light", version: "0.5.0" }));
  app.get("/v1/status", async () => indexStatus(database));
  app.post("/v1/search", async (request, reply) => {
    const parsed = z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).optional(),
      dedupe: z.enum(["none", "file", "title", "content"]).default("file"),
      view: responseView,
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    try {
      const results = search(database, config, parsed.data.query, {
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
        dedupe: parsed.data.dedupe as DedupeMode,
      });
      return {
        status: "ok",
        results: parsed.data.view === "brief" ? compactSearchResults(results) : results,
        nextCursor: null,
        truncated: false,
      };
    } catch (error) {
      return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
    }
  });
  const querySchema = z.discriminatedUnion("operation", [
    z.object({
      operation: z.literal("search"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(config.limits.searchResults).default(3),
      dedupe: z.enum(["none", "file", "title", "content"]).default("file"),
      view: responseView,
    }),
    z.object({
      operation: z.literal("get"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(3),
      view: responseView,
    }),
    z.object({
      operation: z.literal("facts"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(3),
      view: responseView,
    }),
    z.object({
      operation: z.literal("timeline"),
      query: z.string().max(500).optional(),
      anchor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(50).default(10),
      allSources: z.boolean().default(false),
      view: responseView,
    }),
    z.object({ operation: z.literal("status") }),
    z.object({
      operation: z.literal("current_state"),
      recordConversation: z.boolean().default(true),
      scope: z.enum(["weather", "summary", "full"]).default("summary"),
    }),
    z.object({ operation: z.literal("emotional_reflection"), reflection: emotionalReflectionSchema }),
    z.object({ operation: z.literal("agency"), agency: agencyActionSchema }),
    z.object({ operation: z.literal("agency_enforce"), enforcement: agencyEnforcementSchema }),
    z.object({ operation: z.literal("open_hand_repair"), repair: repairActionSchema }),
  ]);
  app.post("/v1/query", async (request, reply) => {
    const parsed = querySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    }
    const input = parsed.data;
    if (input.operation === "status") return indexStatus(database);
    if (input.operation === "current_state") {
      try {
        return await currentState(config, database, input.recordConversation, input.scope, agencyState(database));
      } catch (error) {
        return reply.code(503).send({ status: "unavailable", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (input.operation === "emotional_reflection") {
      try {
        return { status: "ok", result: await reflectEmotion(config, input.reflection) };
      } catch (error) {
        return reply.code(503).send({ status: "unavailable", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (input.operation === "agency") {
      try {
        return { status: "ok", result: operateAgency(database, input.agency) };
      } catch (error) {
        return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (input.operation === "agency_enforce") {
      return { status: "ok", result: evaluateAgencyEnforcement(database, input.enforcement) };
    }
    if (input.operation === "open_hand_repair") {
      try {
        return { status: "ok", result: operateRepair(database, input.repair) };
      } catch (error) {
        return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (input.operation === "search") {
      const results = search(database, config, input.query, {
        limit: input.limit,
        dedupe: input.dedupe,
      });
      return {
        status: "ok",
        results: input.view === "brief" ? compactSearchResults(results) : results,
      };
    }
    if (input.operation === "get") {
      const result = getEntityBrief(database, input.query, input.view === "brief" ? 0 : input.limit);
      return input.view === "brief" ? compactEntityResponse(result) : result;
    }
    if (input.operation === "facts") {
      const result = getEntityAssertions(database, input.query, input.limit);
      return input.view === "brief" ? compactAssertionResponse(result) : result;
    }
    const events = queryChronology(database, {
      ...(input.query ? { query: input.query } : {}),
      ...(input.anchor ? { anchor: input.anchor } : {}),
      limit: input.limit,
      allSources: input.allSources,
    });
    return {
      status: "ok",
      events: input.view === "brief" ? compactTimelineEvents(events) : events,
    };
  });
  return app;
}
