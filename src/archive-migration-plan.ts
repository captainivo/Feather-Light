import { basename, extname, relative } from "node:path";
import { closeSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Config } from "./config.js";
import { proposedPermanentId } from "./archive-migration-audit.js";
import { sha256, stableId } from "./hash.js";
import { safeMarkdownFiles } from "./ingest.js";
import { parseMarkdown } from "./markdown.js";
import { canonStatuses } from "./story-archive-contract.js";

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
  planVersion: number;
  rootId: string;
  batchLimit: number;
  totalEligibleFiles: number;
  plannedFiles: number;
  remainingFiles: number;
  files: ArchiveMigrationPlanFile[];
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

function planFile(rootId: string, rootPath: string, absolutePath: string): ArchiveMigrationPlanFile {
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
  if (!("created" in metadata)) proposals.push({ field: "created", value: null, source: "manual", level: "manual", reason: "Filesystem times are not trusted as canonical creation dates." });
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
  const files = discovered.map((path) => planFile(root.rootId, rootPath, path))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"))
    .slice(0, batchLimit);
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
