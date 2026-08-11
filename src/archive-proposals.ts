import { createHash } from "node:crypto";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";
import { canonStatuses } from "./story-archive-contract.js";

const slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const permanentId = z.string().min(3).max(120).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/);
const relativeMarkdownPath = z.string().min(4).max(500)
  .refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes("..") && value.endsWith(".md"));

const proposalFields = {
  proposalVersion: z.literal(1),
  rootId: slug,
  operation: z.enum(["NEW", "EXPAND", "REVISE", "RETCON", "REORGANIZE", "LINK", "DISCARD"]),
  note: z.object({
    id: permanentId,
    title: z.string().trim().min(1).max(200),
    type: slug,
    status: z.enum(canonStatuses),
    primaryCategory: slug,
    secondaryCategories: z.array(slug).max(50).default([]),
    relativePath: relativeMarkdownPath,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    content: z.string().min(1).max(2_000_000),
  }).strict(),
};

type ProposalFields = z.infer<z.ZodObject<typeof proposalFields>>;

function refineProposal(proposal: ProposalFields, context: z.RefinementCtx): void {
  if (new Set([proposal.note.primaryCategory, ...proposal.note.secondaryCategories]).size !== 1 + proposal.note.secondaryCategories.length) {
    context.addIssue({ code: "custom", path: ["note", "secondaryCategories"], message: "proposal categories must be unique" });
  }
  if (proposal.operation === "NEW" && proposal.note.sourceHash !== null) {
    context.addIssue({ code: "custom", path: ["note", "sourceHash"], message: "new notes cannot have a source hash" });
  }
  if (proposal.operation !== "NEW" && proposal.note.sourceHash === null) {
    context.addIssue({ code: "custom", path: ["note", "sourceHash"], message: "existing-note operations require a source hash" });
  }
}

const proposalCoreSchema = z.object({
  transactionId: z.string().min(1).max(160),
  ...proposalFields,
}).strict().superRefine(refineProposal);

export const archiveProposalInputSchema = z.object({
  ...proposalFields,
  workerId: slug,
  preparedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine(refineProposal);

export const archiveProposalApprovalSchema = z.object({
  proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvedBy: slug,
  approvedAt: z.iso.datetime({ offset: true }),
}).strict();

export type ArchiveProposalCore = z.infer<typeof proposalCoreSchema>;

export interface ArchiveTransactionProposal {
  proposal: ArchiveProposalCore;
  proposalHash: string;
  preparedBy: string;
  preparedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  writerClaimedBy: string | null;
  writerClaimedAt: string | null;
  writerLeaseUntil: string | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function archiveProposalHash(proposal: ArchiveProposalCore): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(proposal))).digest("hex");
}

interface ProposalRow {
  proposal_hash: string; proposal_json: string; prepared_by: string; prepared_at: string;
  approved_by: string | null; approved_at: string | null;
  writer_claimed_by: string | null; writer_claimed_at: string | null; writer_lease_until: string | null;
}

function mapProposal(row: ProposalRow): ArchiveTransactionProposal {
  return {
    proposal: proposalCoreSchema.parse(JSON.parse(row.proposal_json)),
    proposalHash: row.proposal_hash,
    preparedBy: row.prepared_by,
    preparedAt: row.prepared_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    writerClaimedBy: row.writer_claimed_by,
    writerClaimedAt: row.writer_claimed_at,
    writerLeaseUntil: row.writer_lease_until,
  };
}

export function getArchiveTransactionProposal(database: FeatherDatabase, transactionId: string): ArchiveTransactionProposal | null {
  const row = database.prepare(`SELECT proposal_hash, proposal_json, prepared_by, prepared_at, approved_by, approved_at,
      writer_claimed_by, writer_claimed_at, writer_lease_until
    FROM archive_transaction_proposals WHERE transaction_id=?`).get(transactionId) as ProposalRow | undefined;
  return row ? mapProposal(row) : null;
}

export function prepareArchiveTransactionProposal(database: FeatherDatabase, transactionId: string, value: unknown): ArchiveTransactionProposal {
  const input = archiveProposalInputSchema.parse(value);
  const transaction = database.prepare("SELECT status, claimed_by FROM archive_transactions WHERE transaction_id=?").get(transactionId) as { status: string; claimed_by: string | null } | undefined;
  if (!transaction) throw new Error(`unknown archive transaction: ${transactionId}`);
  if (transaction.status !== "processing" || transaction.claimed_by !== input.workerId) throw new Error("archive proposal requires the claiming worker");
  const { workerId, preparedAt, ...proposalInput } = input;
  const proposal = proposalCoreSchema.parse({ ...proposalInput, transactionId });
  const proposalHash = archiveProposalHash(proposal);
  const existing = getArchiveTransactionProposal(database, transactionId);
  if (existing) {
    if (existing.proposalHash === proposalHash && existing.preparedBy === workerId) return existing;
    throw new Error("archive transaction already has a different proposal");
  }
  database.prepare(`INSERT INTO archive_transaction_proposals(
    transaction_id, proposal_hash, proposal_json, prepared_by, prepared_at
  ) VALUES (?, ?, ?, ?, ?)`).run(transactionId, proposalHash, JSON.stringify(canonicalize(proposal)), workerId, preparedAt);
  return getArchiveTransactionProposal(database, transactionId)!;
}

export function approveArchiveTransactionProposal(database: FeatherDatabase, transactionId: string, value: unknown): ArchiveTransactionProposal {
  const approval = archiveProposalApprovalSchema.parse(value);
  const existing = getArchiveTransactionProposal(database, transactionId);
  if (!existing) throw new Error(`unknown archive proposal: ${transactionId}`);
  if (existing.proposalHash !== approval.proposalHash) throw new Error("approval hash does not match current proposal");
  const transaction = database.prepare("SELECT status FROM archive_transactions WHERE transaction_id=?").get(transactionId) as { status: string } | undefined;
  if (transaction?.status !== "processing") throw new Error("only processing transactions can be approved");
  if (existing.approvedAt) {
    if (existing.approvedBy === approval.approvedBy && existing.approvedAt === approval.approvedAt) return existing;
    throw new Error("archive proposal is already approved with different provenance");
  }
  const result = database.prepare(`UPDATE archive_transaction_proposals SET approved_by=?, approved_at=?
    WHERE transaction_id=? AND proposal_hash=? AND approved_at IS NULL`).run(
    approval.approvedBy, approval.approvedAt, transactionId, approval.proposalHash,
  );
  if (result.changes !== 1) throw new Error("archive proposal approval changed concurrently");
  return getArchiveTransactionProposal(database, transactionId)!;
}
