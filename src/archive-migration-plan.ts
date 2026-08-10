import { basename, extname, relative } from "node:path";
import { closeSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Config } from "./config.js";
import { proposedPermanentId } from "./archive-migration-audit.js";
import { sha256, stableId } from "./hash.js";
import { safeMarkdownFiles } from "./ingest.js";
import { parseMarkdown } from "./markdown.js";
import { canonStatuses } from "./story-archive-contract.js";
import { findGitRepository, gitFirstAddEvidence } from "./git-history.js";
import { z } from "zod";

type ReviewLevel = "mechanical" | "review" | "manual";

export interface MigrationFieldProposal {
  field: string;
  value: unknown;
  source: string;
  level: ReviewLevel;
  reason: string;
}

export interface ArchiveMigrationPlanFile {
  relativePath: string;
  sourceHash: string;
  disposition: "mechanical" | "review_required" | "manual_required";
  proposals: MigrationFieldProposal[];
}

export interface ArchiveMigrationPlan {
  planVersion: 1;
  rootId: string;
  batchLimit: number;
  totalEligibleFiles: number;
  plannedFiles: number;
  remainingFiles: number;
  files: ArchiveMigrationPlanFile[];
}

const relativeArchivePath = z.string().min(1).refine(
  (value) => !value.startsWith("/") && !value.startsWith("\\") && !value.split(/[\\/]/).includes(".."),
  "must be a relative path contained by the archive root",
);

export const archiveMigrationPlanSchema = z.object({
  planVersion: z.literal(1),
  rootId: z.string().min(1),
  batchLimit: z.number().int().min(1).max(500),
  totalEligibleFiles: z.number().int().nonnegative(),
  plannedFiles: z.number().int().nonnegative(),
  remainingFiles: z.number().int().nonnegative(),
  files: z.array(z.object({
    relativePath: relativeArchivePath,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    disposition: z.enum(["mechanical", "review_required", "manual_required"]),
    proposals: z.array(z.object({
      field: z.string().min(1),
      value: z.unknown(),
      source: z.string().min(1),
      level: z.enum(["mechanical", "review", "manual"]),
      reason: z.string().min(1),
    }).strict()),
  }).strict()),
}).strict().superRefine((plan, context) => {
  if (plan.plannedFiles !== plan.files.length) context.addIssue({ code: "custom", path: ["plannedFiles"], message: "must equal files length" });
  if (plan.totalEligibleFiles !== plan.plannedFiles + plan.remainingFiles) context.addIssue({ code: "custom", path: ["totalEligibleFiles"], message: "must equal planned plus remaining files" });
});

export function parseArchiveMigrationPlan(value: unknown): ArchiveMigrationPlan {
  return archiveMigrationPlanSchema.parse(value);
}

export function archiveMigrationPlanHash(plan: ArchiveMigrationPlan): string {
  return sha256(JSON.stringify(parseArchiveMigrationPlan(plan)));
}

const directoryDefaults: Array<[string, string, string]> = [
  ["03 - Characters/", "character", "character"],
  ["04 - Civilizations and Peoples/", "people", "civilization"],
  ["05 - Places/", "place", "place"],
  ["06 - Systems/", "system", "technology"],
  ["07 - Timeline/", "timeline", "history"],
  ["09 - Lore Library/", "lore", "lore"],
  ["10 - Drafting/", "drafting", "drafting"],
  ["11 - Templates/", "template", "template"],
  ["13 - TODO/", "todo", "todo"],
  ["99 - Source Notes/", "source-note", "source"],
];

function slug(value: string): string {
  return value.normalize("NFKD").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function listValue(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.map((item) => slug(item)).filter(Boolean);
  if (typeof value === "string") return value.split("/").map((item) => slug(item)).filter(Boolean);
  return null;
}

function defaultsForPath(relativePath: string): { type: string; category: string } | null {
  const match = directoryDefaults.find(([prefix]) => relativePath.startsWith(prefix));
  return match ? { type: match[1], category: match[2] } : null;
}

function statusProposal(frontmatter: Record<string, unknown>): MigrationFieldProposal {
  const status = frontmatter.status;
  if (typeof status === "string" && (canonStatuses as readonly string[]).includes(status)) {
    return { field: "status", value: status, source: "status", level: "mechanical", reason: "Existing value already uses the new canon vocabulary." };
  }
  const canon = frontmatter.canon;
  const mapping: Record<string, string> = { developing: "draft", unconfirmed: "speculative", conflicted: "contradicted" };
  if (typeof canon === "string" && mapping[canon]) {
    return { field: "status", value: mapping[canon], source: "canon", level: "review", reason: `Legacy canon value '${canon}' has a conservative proposed mapping.` };
  }
  if (status === "seed") {
    return { field: "status", value: "speculative", source: "status", level: "review", reason: "Legacy workflow status 'seed' is not itself a canon decision." };
  }
  return { field: "status", value: null, source: "manual", level: "manual", reason: "No safe canon-status mapping exists." };
}

function planFile(rootId: string, rootPath: string, absolutePath: string, gitRepository: string | null): ArchiveMigrationPlanFile {
  const before = statSync(absolutePath, { bigint: true });
  const descriptor = openSync(absolutePath, "r");
  let buffer: Buffer;
  try {
    buffer = readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const after = statSync(absolutePath, { bigint: true });
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) throw new Error("file changed while being read");
  const relativePath = relative(rootPath, absolutePath);
  const parsed = parseMarkdown(stableId("src", `${rootId}:${relativePath}`), basename(relativePath, extname(relativePath)), buffer.toString("utf8"));
  const metadata = parsed.frontmatter;
  const defaults = defaultsForPath(relativePath);
  const proposals: MigrationFieldProposal[] = [];
  if (!("id" in metadata)) proposals.push({ field: "id", value: proposedPermanentId(rootId, relativePath, parsed.title, metadata.type ?? defaults?.type), source: "root-and-path", level: "mechanical", reason: "Deterministic proposed permanent ID; no file write is performed." });
  if (!("title" in metadata)) proposals.push({ field: "title", value: parsed.title, source: "h1-or-filename", level: "mechanical", reason: "Existing parser title fallback preserves the displayed title." });
  if (!("type" in metadata)) proposals.push(defaults
    ? { field: "type", value: defaults.type, source: "directory", level: "review", reason: "Directory convention supplies a proposal but may not describe every note." }
    : { field: "type", value: null, source: "manual", level: "manual", reason: "No explicit type or recognized directory convention." });
  else if (typeof metadata.type === "string" && slug(metadata.type) !== metadata.type) proposals.push({
    field: "type", value: slug(metadata.type), source: "type", level: "review", reason: "Legacy type was slug-normalized and requires review.",
  });
  else if (typeof metadata.type !== "string") proposals.push({ field: "type", value: null, source: "manual", level: "manual", reason: "Legacy type is not text." });
  if (!("status" in metadata) || !(canonStatuses as readonly unknown[]).includes(metadata.status)) proposals.push(statusProposal(metadata));
  const primary = typeof metadata.primary_category === "string" ? metadata.primary_category : defaults?.category;
  if (!("primary_category" in metadata)) proposals.push(primary
    ? { field: "primary_category", value: primary, source: "directory", level: "review", reason: "Directory convention supplies a reporting category proposal." }
    : { field: "primary_category", value: null, source: "manual", level: "manual", reason: "No safe primary category is available." });
  if (!("categories" in metadata)) proposals.push({ field: "categories", value: primary ? [primary] : [], source: primary ? "primary-category" : "manual", level: primary ? "review" : "manual", reason: primary ? "Start with the proposed primary category." : "Categories require classification." });
  if (!("regions" in metadata)) {
    const regions = listValue(metadata.region);
    proposals.push({ field: "regions", value: regions ?? [], source: regions ? "region" : "empty-default", level: regions ? "review" : "mechanical", reason: regions ? "Legacy region values were slug-normalized and require review." : "No legacy region metadata exists." });
  }
  if (!("eras" in metadata)) {
    const eras = listValue(metadata.era);
    proposals.push({ field: "eras", value: eras ?? [], source: eras ? "era" : "empty-default", level: eras ? "review" : "mechanical", reason: eras ? "Legacy era values were split and slug-normalized and require review." : "No legacy era metadata exists." });
  }
  if (!("aliases" in metadata)) proposals.push({ field: "aliases", value: [], source: "empty-default", level: "mechanical", reason: "No legacy aliases field exists." });
  else if (typeof metadata.aliases === "string") proposals.push({ field: "aliases", value: [metadata.aliases], source: "aliases", level: "review", reason: "Legacy scalar alias was converted to a one-item array." });
  else if (!Array.isArray(metadata.aliases) || !metadata.aliases.every((item) => typeof item === "string")) proposals.push({ field: "aliases", value: null, source: "manual", level: "manual", reason: "Legacy aliases value is neither text nor a text array." });
  if (!("created" in metadata)) {
    const evidence = gitRepository ? gitFirstAddEvidence(gitRepository, absolutePath) : null;
    if (evidence) {
      proposals.push(
        { field: "created", value: evidence.createdDate, source: `git-first-add:${evidence.commit}`, level: "review", reason: `Git author timestamp ${evidence.authoredAt} is evidence, not unquestionable canon.` },
        { field: "created_source", value: "git-first-add", source: `git-first-add:${evidence.commit}`, level: "mechanical", reason: "Records the provenance class for the proposed date." },
      );
    } else {
      proposals.push(
        { field: "created", value: "unknown", source: "legacy-import", level: "mechanical", reason: gitRepository ? "No first-add commit was found; no date is invented." : "The archive has no Git history; filesystem times are not trusted." },
        { field: "created_source", value: "legacy-import", source: "legacy-import", level: "mechanical", reason: "Makes creation-date uncertainty explicit and auditable." },
      );
    }
  }
  const levels = new Set(proposals.map((proposal) => proposal.level));
  return {
    relativePath,
    sourceHash: sha256(buffer),
    disposition: levels.has("manual") ? "manual_required" : levels.has("review") ? "review_required" : "mechanical",
    proposals,
  };
}

export function planArchiveMigration(config: Config, rootId: string, batchLimit = 20): ArchiveMigrationPlan {
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 500) throw new Error("batch limit must be between 1 and 500");
  const root = config.archiveRoots.find((candidate) => candidate.rootId === rootId && candidate.enabled);
  if (!root) throw new Error(`unknown or disabled archive root: ${rootId}`);
  const rootPath = realpathSync(root.path);
  const discovered = safeMarkdownFiles(root.path, config.limits.maxFileBytes);
  const gitRepository = findGitRepository(rootPath);
  const files = discovered
    .sort((left, right) => relative(rootPath, left).localeCompare(relative(rootPath, right), "en"))
    .slice(0, batchLimit)
    .map((path) => planFile(root.rootId, rootPath, path, gitRepository));
  return {
    planVersion: 1,
    rootId,
    batchLimit,
    totalEligibleFiles: discovered.length,
    plannedFiles: files.length,
    remainingFiles: Math.max(0, discovered.length - files.length),
    files,
  };
}
