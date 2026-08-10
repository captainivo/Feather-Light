import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { currentState, emotionalReflectionSchema, reflectEmotion } from "./aauthora.js";
import { agencyActionSchema, agencyState, operateAgency } from "./agency.js";
import { agencyEnforcementSchema, evaluateAgencyEnforcement } from "./open-hand/enforcement.js";
import { operateRepair, repairActionSchema } from "./open-hand/repair.js";
import { projectAgencyContext } from "./open-hand/projection.js";
import { queryChronology } from "./chronology.js";
import { compactAssertionResponse, compactEntityResponse, compactSearchResults, compactTimelineEvents } from "./compact.js";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { getEntityAssertions, getEntityBrief } from "./knowledge.js";
import { search, type DedupeMode } from "./search.js";
import { indexStatus } from "./status.js";
import { dreamActionSchema, generateDream, operateDream } from "./dream.js";
import { growthActionSchema, longingActionSchema, operateGrowth, operateLonging } from "./inner.js";
import { archiveSubmissionSchema } from "./story-archive-contract.js";
import { archiveTransactionStatuses, getArchiveTransaction, listArchiveTransactions, recordArchiveSubmission, transitionArchiveTransaction } from "./archive-transactions.js";
import { archiveDevelopmentReport } from "./archive-ledger.js";

const responseView = z.enum(["brief", "standard"]).default("brief");

export function buildServer(config: Config, database: FeatherDatabase) {
  const app = Fastify({
    logger: true,
    bodyLimit: Math.max(config.limits.maxFileBytes, config.limits.responseCharacters),
  });
  const apiToken = config.server.authTokenFile ? readFileSync(config.server.authTokenFile, "utf8").trim() : null;
  if (config.server.authTokenFile && !apiToken) throw new Error("Feather-Light API token file is empty");
  app.addHook("onRequest", async (request, reply) => {
    if (!apiToken || request.url === "/health") return;
    const supplied = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice("Bearer ".length)
      : "";
    const expectedBuffer = Buffer.from(apiToken);
    const suppliedBuffer = Buffer.from(supplied);
    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      return reply.code(401).send({ status: "unauthorized" });
    }
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    if (typeof payload !== "string" || payload.length <= config.limits.responseCharacters) return payload;
    reply.code(500);
    return JSON.stringify({ status: "response_limited", error: "response exceeded configured character limit" });
  });
  app.get("/health", async () => ({ status: "ok", service: "feather-light", version: "0.4.0" }));
  app.get("/v1/status", async () => indexStatus(database));
  app.post("/v1/archive/validate", async (request, reply) => {
    const parsed = archiveSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    }
    const submission = parsed.data;
    return {
      status: "valid",
      persisted: false,
      submission: {
        submission_id: submission.submission_id,
        mode: submission.mode,
        source_client: submission.source_client,
        submitted_at: submission.submitted_at,
        requested_status: submission.requested_status,
        primary_subject: submission.primary_subject ?? null,
        targets: submission.targets,
        categories: submission.categories,
        metadata: submission.metadata,
        content_characters: submission.content.length,
      },
    };
  });
  app.post("/v1/archive/submissions", async (request, reply) => {
    const parsed = archiveSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    }
    const result = recordArchiveSubmission(database, parsed.data);
    if (result.outcome === "conflict") {
      return reply.code(409).send({
        status: "idempotency_conflict",
        submission_id: parsed.data.submission_id,
        transaction_id: result.transaction.transactionId,
      });
    }
    return reply.code(result.outcome === "created" ? 202 : 200).send({
      status: "accepted",
      persisted: true,
      replayed: result.outcome === "replayed",
      submission_id: result.transaction.submissionId,
      transaction_id: result.transaction.transactionId,
      transaction_status: result.transaction.status,
    });
  });
  app.get("/v1/archive/reports/development", async (request, reply) => {
    const parsed = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    try {
      return { status: "ok", report: archiveDevelopmentReport(database, parsed.data.from, parsed.data.to) };
    } catch (error) {
      return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get("/v1/archive/transactions", async (request, reply) => {
    const parsed = z.object({ status: z.enum(archiveTransactionStatuses).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    return { status: "ok", transactions: listArchiveTransactions(database, {
      limit: parsed.data.limit,
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    }) };
  });
  app.get("/v1/archive/transactions/:transactionId", async (request, reply) => {
    const parsed = z.object({ transactionId: z.string().min(1) }).strict().safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ status: "invalid_request", error: parsed.error.issues });
    const transaction = getArchiveTransaction(database, parsed.data.transactionId);
    return transaction ? { status: "ok", transaction } : reply.code(404).send({ status: "not_found" });
  });
  app.patch("/v1/archive/transactions/:transactionId", async (request, reply) => {
    const params = z.object({ transactionId: z.string().min(1) }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ status: "invalid_request", error: params.error.issues });
    try {
      return { status: "ok", transaction: transitionArchiveTransaction(database, params.data.transactionId, request.body) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message.startsWith("unknown archive transaction") ? 404 : 409).send({ status: "transition_rejected", error: message });
    }
  });
  app.post("/v1/search", async (request, reply) => {
    const parsed = z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).optional(),
      dedupe: z.enum(["none", "file", "title", "content"]).default("file"),
      view: responseView,
    }).strict().safeParse(request.body);
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
    }).strict(),
    z.object({
      operation: z.literal("get"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(3),
      view: responseView,
    }).strict(),
    z.object({
      operation: z.literal("facts"),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(3),
      view: responseView,
    }).strict(),
    z.object({
      operation: z.literal("timeline"),
      query: z.string().max(500).optional(),
      anchor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(50).default(10),
      allSources: z.boolean().default(false),
      view: responseView,
    }).strict(),
    z.object({ operation: z.literal("status") }).strict(),
    z.object({
      operation: z.literal("current_state"),
      recordConversation: z.boolean().default(true),
      scope: z.enum(["weather", "summary", "full"]).default("summary"),
    }).strict(),
    z.object({ operation: z.literal("emotional_reflection"), reflection: emotionalReflectionSchema }).strict(),
    z.object({ operation: z.literal("agency"), agency: agencyActionSchema }).strict(),
    z.object({ operation: z.literal("agency_projection") }).strict(),
    z.object({ operation: z.literal("agency_enforce"), enforcement: agencyEnforcementSchema }).strict(),
    z.object({ operation: z.literal("open_hand_repair"), repair: repairActionSchema }).strict(),
    z.object({ operation: z.literal("growth"), growth: growthActionSchema }).strict(),
    z.object({ operation: z.literal("longing"), longing: longingActionSchema }).strict(),
    z.object({ operation: z.literal("dream"), dream: dreamActionSchema }).strict(),
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
    if (input.operation === "agency_projection") {
      return { status: "ok", result: projectAgencyContext(database) };
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
    if (input.operation === "growth") {
      try {
        return { status: "ok", result: operateGrowth(database, input.growth) };
      } catch (error) {
        return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (input.operation === "longing") {
      try {
        return { status: "ok", result: operateLonging(database, input.longing) };
      } catch (error) {
        return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (input.operation === "dream") {
      try {
        if (input.dream.action === "generate") {
          return { status: "ok", result: await generateDream(database, config, input.dream.note) };
        }
        return { status: "ok", result: operateDream(database, input.dream) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (input.dream.action === "generate") {
          return reply.code(503).send({ status: "unavailable", error: message });
        }
        return reply.code(400).send({ status: "invalid_request", error: message });
      }
    }
    if (input.operation === "search") {
      try {
        const results = search(database, config, input.query, {
          limit: input.limit,
          dedupe: input.dedupe,
        });
        return {
          status: "ok",
          results: input.view === "brief" ? compactSearchResults(results) : results,
        };
      } catch (error) {
        return reply.code(400).send({ status: "invalid_request", error: error instanceof Error ? error.message : String(error) });
      }
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
