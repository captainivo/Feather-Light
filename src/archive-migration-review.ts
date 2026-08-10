import { basename, extname, join, relative } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { z } from "zod";
import type { Config } from "./config.js";
import { archiveMigrationPlanHash, type ArchiveMigrationPlan, type MigrationFieldProposal } from "./archive-migration-plan.js";
import { sha256, stableId } from "./hash.js";
import { parseMarkdown } from "./markdown.js";
import { storyNoteMetadataSchema } from "./story-archive-contract.js";

const decisionSchema = z.object({
  relativePath: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  field: z.string().min(1),
  action: z.enum(["pending", "approve", "replace", "reject"]),
  value: z.unknown().optional(),
  reviewer: z.string().trim().min(1).max(120).optional(),
  decidedAt: z.iso.datetime({ offset: true }).optional(),
  proposal: z.object({ value: z.unknown(), level: z.enum(["review", "manual"]), source: z.string(), reason: z.string() }).strict().optional(),
}).strict().superRefine((decision, context) => {
  if (decision.action === "replace" && decision.value === undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: "replace decisions require a value" });
  }
  if (decision.action !== "replace" && decision.value !== undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: `${decision.action} decisions cannot provide a value` });
  }
  if (decision.action !== "pending" && (!decision.reviewer || !decision.decidedAt)) {
    context.addIssue({ code: "custom", path: ["reviewer"], message: "completed decisions require reviewer and decidedAt" });
  }
  if (decision.action === "pending" && (decision.reviewer || decision.decidedAt)) {
    context.addIssue({ code: "custom", path: ["reviewer"], message: "pending decisions cannot have review provenance" });
  }
});

export const archiveMigrationReviewSchema = z.object({
  reviewVersion: z.literal(1),
  planVersion: z.literal(1),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  rootId: z.string().min(1),
  decisions: z.array(decisionSchema),
}).strict();

export type ArchiveMigrationReview = z.infer<typeof archiveMigrationReviewSchema>;

export interface ArchiveMigrationSimulationFile {
  relativePath: string;
  sourceHash: string;
  status: "ready" | "unresolved" | "stale" | "invalid";
  appliedFields: string[];
  unresolvedFields: string[];
  rejectedFields: string[];
  issues: Array<{ field: string; message: string }>;
}

export interface ArchiveMigrationSimulation {
  simulationVersion: 1;
  rootId: string;
  readOnly: true;
  files: ArchiveMigrationSimulationFile[];
  summary: { ready: number; unresolved: number; stale: number; invalid: number };
}

export interface ArchiveMigrationChangeSet {
  changeSetVersion: 1;
  rootId: string;
  planHash: string;
  readOnly: true;
  files: Array<{
    relativePath: string;
    sourceHash: string;
    changes: Array<{
      field: string;
      value: unknown;
      authority: "mechanical" | "approved" | "replaced";
      reviewer?: string;
      decidedAt?: string;
    }>;
  }>;
  changeSetHash: string;
}

function proposalKey(relativePath: string, field: string): string {
  return `${relativePath}\u0000${field}`;
}

function decisionValue(proposal: MigrationFieldProposal, decision: z.infer<typeof decisionSchema> | undefined): unknown {
  if (proposal.level === "mechanical") return proposal.value;
  if (decision?.action === "approve") return proposal.value;
  if (decision?.action === "replace") return decision.value;
  return undefined;
}

export function createArchiveMigrationReviewTemplate(plan: ArchiveMigrationPlan): ArchiveMigrationReview {
  return {
    reviewVersion: 1,
    planVersion: 1,
    planHash: archiveMigrationPlanHash(plan),
    rootId: plan.rootId,
    decisions: plan.files.flatMap((file) => file.proposals
      .filter((proposal): proposal is MigrationFieldProposal & { level: "review" | "manual" } => proposal.level !== "mechanical")
      .map((proposal) => ({
        relativePath: file.relativePath,
        sourceHash: file.sourceHash,
        field: proposal.field,
        action: "pending" as const,
        proposal: { value: proposal.value, level: proposal.level, source: proposal.source, reason: proposal.reason },
      }))),
  };
}

export function parseArchiveMigrationReview(value: unknown): ArchiveMigrationReview {
  const review = archiveMigrationReviewSchema.parse(value);
  const keys = new Set<string>();
  for (const decision of review.decisions) {
    const key = proposalKey(decision.relativePath, decision.field);
    if (keys.has(key)) throw new Error(`duplicate migration decision: ${decision.relativePath}:${decision.field}`);
    keys.add(key);
  }
  return review;
}

export function simulateArchiveMigration(
  config: Config,
  plan: ArchiveMigrationPlan,
  reviewValue: unknown,
): ArchiveMigrationSimulation {
  const review = parseArchiveMigrationReview(reviewValue);
  if (review.rootId !== plan.rootId) throw new Error("review root does not match migration plan");
  if (review.planVersion !== plan.planVersion) throw new Error("review plan version does not match migration plan");
  if (review.planHash !== archiveMigrationPlanHash(plan)) throw new Error("review plan hash does not match migration plan");
  const root = config.archiveRoots.find((candidate) => candidate.rootId === plan.rootId && candidate.enabled);
  if (!root) throw new Error(`unknown or disabled archive root: ${plan.rootId}`);
  const rootPath = realpathSync(root.path);
  const proposals = new Map(plan.files.flatMap((file) => file.proposals.map((proposal) => [
    proposalKey(file.relativePath, proposal.field), proposal,
  ] as const)));
  const decisions = new Map(review.decisions.map((decision) => {
    const key = proposalKey(decision.relativePath, decision.field);
    if (!proposals.has(key)) throw new Error(`decision does not match a proposal: ${decision.relativePath}:${decision.field}`);
    return [key, decision] as const;
  }));

  const files = plan.files.map((file): ArchiveMigrationSimulationFile => {
    const absolutePath = join(rootPath, file.relativePath);
    if (relative(rootPath, absolutePath).startsWith("..")) throw new Error("migration plan path escapes archive root");
    const buffer = readFileSync(absolutePath);
    const currentHash = sha256(buffer);
    if (currentHash !== file.sourceHash) {
      return { relativePath: file.relativePath, sourceHash: currentHash, status: "stale", appliedFields: [], unresolvedFields: [], rejectedFields: [], issues: [{ field: "$file", message: "source hash changed after planning" }] };
    }
    const parsed = parseMarkdown(stableId("src", `${plan.rootId}:${file.relativePath}`), basename(file.relativePath, extname(file.relativePath)), buffer.toString("utf8"));
    const prospective = { ...parsed.frontmatter };
    const appliedFields: string[] = [];
    const unresolvedFields: string[] = [];
    const rejectedFields: string[] = [];
    for (const proposal of file.proposals) {
      const decision = decisions.get(proposalKey(file.relativePath, proposal.field));
      if (decision && decision.sourceHash !== file.sourceHash) {
        return { relativePath: file.relativePath, sourceHash: currentHash, status: "stale", appliedFields: [], unresolvedFields: [], rejectedFields: [], issues: [{ field: proposal.field, message: "decision source hash does not match plan" }] };
      }
      if (decision?.action === "reject") {
        rejectedFields.push(proposal.field);
        continue;
      }
      const value = decisionValue(proposal, decision?.action === "pending" ? undefined : decision);
      if (value === undefined) unresolvedFields.push(proposal.field);
      else {
        prospective[proposal.field] = value;
        appliedFields.push(proposal.field);
      }
    }
    if (unresolvedFields.length > 0 || rejectedFields.length > 0) {
      return { relativePath: file.relativePath, sourceHash: currentHash, status: "unresolved", appliedFields, unresolvedFields, rejectedFields, issues: [] };
    }
    const validation = storyNoteMetadataSchema.safeParse(prospective);
    if (!validation.success) {
      return {
        relativePath: file.relativePath,
        sourceHash: currentHash,
        status: "invalid",
        appliedFields,
        unresolvedFields,
        rejectedFields,
        issues: validation.error.issues.map((issue) => ({ field: String(issue.path[0] ?? "$metadata"), message: issue.message })),
      };
    }
    return { relativePath: file.relativePath, sourceHash: currentHash, status: "ready", appliedFields, unresolvedFields, rejectedFields, issues: [] };
  });
  return {
    simulationVersion: 1,
    rootId: plan.rootId,
    readOnly: true,
    files,
    summary: {
      ready: files.filter((file) => file.status === "ready").length,
      unresolved: files.filter((file) => file.status === "unresolved").length,
      stale: files.filter((file) => file.status === "stale").length,
      invalid: files.filter((file) => file.status === "invalid").length,
    },
  };
}

export function buildArchiveMigrationChangeSet(
  config: Config,
  plan: ArchiveMigrationPlan,
  reviewValue: unknown,
): ArchiveMigrationChangeSet {
  const simulation = simulateArchiveMigration(config, plan, reviewValue);
  if (simulation.summary.ready !== plan.files.length) {
    throw new Error(`change set requires every file to be ready: ${JSON.stringify(simulation.summary)}`);
  }
  const review = parseArchiveMigrationReview(reviewValue);
  const decisions = new Map(review.decisions.map((decision) => [proposalKey(decision.relativePath, decision.field), decision] as const));
  const core = {
    changeSetVersion: 1 as const,
    rootId: plan.rootId,
    planHash: archiveMigrationPlanHash(plan),
    readOnly: true as const,
    files: plan.files.map((file) => ({
      relativePath: file.relativePath,
      sourceHash: file.sourceHash,
      changes: file.proposals.map((proposal) => {
        const decision = decisions.get(proposalKey(file.relativePath, proposal.field));
        const value = decisionValue(proposal, decision);
        if (value === undefined) throw new Error("ready simulation produced an unresolved proposal");
        if (proposal.level === "mechanical") return { field: proposal.field, value, authority: "mechanical" as const };
        if (!decision?.reviewer || !decision.decidedAt) throw new Error("reviewed proposal is missing provenance");
        return {
          field: proposal.field,
          value,
          authority: decision.action === "replace" ? "replaced" as const : "approved" as const,
          reviewer: decision.reviewer,
          decidedAt: decision.decidedAt,
        };
      }),
    })),
  };
  return { ...core, changeSetHash: sha256(JSON.stringify(core)) };
}
