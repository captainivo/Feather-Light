import { createHash, randomUUID } from "node:crypto";
import type { FeatherDatabase } from "./database.js";
import type { ArchiveSubmission } from "./story-archive-contract.js";
import { z } from "zod";

export const archiveTransactionStatuses = ["pending", "processing", "succeeded", "failed", "partial"] as const;

export interface ArchiveTransaction {
  transactionId: string;
  submissionId: string;
  requestHash: string;
  mode: ArchiveSubmission["mode"];
  sourceClient: string;
  submittedAt: string;
  receivedAt: string;
  requestedStatus: ArchiveSubmission["requested_status"];
  status: "pending" | "processing" | "succeeded" | "failed" | "partial";
  claimedBy: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  gitCommit: string | null;
  errorSummary: string | null;
}

export type RecordArchiveSubmissionResult =
  | { outcome: "created"; transaction: ArchiveTransaction }
  | { outcome: "replayed"; transaction: ArchiveTransaction }
  | { outcome: "conflict"; transaction: ArchiveTransaction };

interface TransactionRow {
  transaction_id: string;
  submission_id: string;
  request_hash: string;
  mode: ArchiveSubmission["mode"];
  source_client: string;
  submitted_at: string;
  received_at: string;
  requested_status: ArchiveSubmission["requested_status"];
  status: ArchiveTransaction["status"];
  claimed_by: string | null;
  processing_started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  git_commit: string | null;
  error_summary: string | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalSubmissionJson(submission: ArchiveSubmission): string {
  return JSON.stringify(canonicalize(submission));
}

export function archiveSubmissionHash(submission: ArchiveSubmission): string {
  return createHash("sha256").update(canonicalSubmissionJson(submission)).digest("hex");
}

function mapTransaction(row: TransactionRow): ArchiveTransaction {
  return {
    transactionId: row.transaction_id,
    submissionId: row.submission_id,
    requestHash: row.request_hash,
    mode: row.mode,
    sourceClient: row.source_client,
    submittedAt: row.submitted_at,
    receivedAt: row.received_at,
    requestedStatus: row.requested_status,
    status: row.status,
    claimedBy: row.claimed_by,
    processingStartedAt: row.processing_started_at,
    completedAt: row.completed_at,
    summary: row.summary,
    gitCommit: row.git_commit,
    errorSummary: row.error_summary,
  };
}

export function recordArchiveSubmission(
  database: FeatherDatabase,
  submission: ArchiveSubmission,
  receivedAt = new Date().toISOString(),
): RecordArchiveSubmissionResult {
  const requestJson = canonicalSubmissionJson(submission);
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const transactionId = `ATX-${randomUUID()}`;
  const result = database.prepare(`
    INSERT OR IGNORE INTO archive_transactions(
      transaction_id, submission_id, request_hash, request_json, mode, source_client,
      submitted_at, received_at, requested_status, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    transactionId,
    submission.submission_id,
    requestHash,
    requestJson,
    submission.mode,
    submission.source_client,
    submission.submitted_at,
    receivedAt,
    submission.requested_status,
  );
  const row = database.prepare(`
    SELECT transaction_id, submission_id, request_hash, mode, source_client,
      submitted_at, received_at, requested_status, status, claimed_by, processing_started_at,
      completed_at, summary, git_commit, error_summary
    FROM archive_transactions WHERE submission_id = ?
  `).get(submission.submission_id) as TransactionRow | undefined;
  if (!row) throw new Error("archive transaction insert did not produce a readable row");
  const transaction = mapTransaction(row);
  if (result.changes === 1) return { outcome: "created", transaction };
  return row.request_hash === requestHash
    ? { outcome: "replayed", transaction }
    : { outcome: "conflict", transaction };
}

const transactionColumns = `transaction_id, submission_id, request_hash, mode, source_client,
  submitted_at, received_at, requested_status, status, claimed_by, processing_started_at,
  completed_at, summary, git_commit, error_summary`;

export function getArchiveTransaction(database: FeatherDatabase, transactionId: string): ArchiveTransaction | null {
  const row = database.prepare(`SELECT ${transactionColumns} FROM archive_transactions WHERE transaction_id = ?`).get(transactionId) as TransactionRow | undefined;
  return row ? mapTransaction(row) : null;
}

export function listArchiveTransactions(
  database: FeatherDatabase,
  options: { status?: ArchiveTransaction["status"]; limit?: number } = {},
): ArchiveTransaction[] {
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 20);
  const status = options.status === undefined ? undefined : z.enum(archiveTransactionStatuses).parse(options.status);
  const rows = status
    ? database.prepare(`SELECT ${transactionColumns} FROM archive_transactions WHERE status = ? ORDER BY received_at DESC, transaction_id DESC LIMIT ?`).all(status, limit)
    : database.prepare(`SELECT ${transactionColumns} FROM archive_transactions ORDER BY received_at DESC, transaction_id DESC LIMIT ?`).all(limit);
  return (rows as TransactionRow[]).map(mapTransaction);
}

export const archiveTransactionClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  occurredAt: z.iso.datetime({ offset: true }),
  modes: z.array(z.enum(["capture", "develop", "archive", "update", "retcon", "discard", "lookup", "report"])).min(1).max(8).optional(),
}).strict();

export function claimNextArchiveTransaction(database: FeatherDatabase, value: unknown): ArchiveTransaction | null {
  const claim = archiveTransactionClaimSchema.parse(value);
  return database.transaction(() => {
    const modeClause = claim.modes ? ` AND mode IN (${claim.modes.map(() => "?").join(",")})` : "";
    const next = database.prepare(`
      SELECT transaction_id FROM archive_transactions
      WHERE status='pending'${modeClause} ORDER BY received_at, transaction_id LIMIT 1
    `).get(...(claim.modes ?? [])) as { transaction_id: string } | undefined;
    if (!next) return null;
    const result = database.prepare(`
      UPDATE archive_transactions
      SET status='processing', claimed_by=?, processing_started_at=?
      WHERE transaction_id=? AND status='pending'
    `).run(claim.workerId, claim.occurredAt, next.transaction_id);
    if (result.changes !== 1) throw new Error("archive transaction claim changed concurrently");
    return getArchiveTransaction(database, next.transaction_id)!;
  })();
}

export interface ArchiveTransactionWork {
  transaction: ArchiveTransaction;
  request: ArchiveSubmission;
}

export function getClaimedArchiveTransactionWork(
  database: FeatherDatabase,
  transactionId: string,
  workerId: string,
): ArchiveTransactionWork {
  const worker = z.string().trim().min(1).max(120).parse(workerId);
  const row = database.prepare(`
    SELECT request_json FROM archive_transactions
    WHERE transaction_id=? AND status='processing' AND claimed_by=?
  `).get(transactionId, worker) as { request_json: string } | undefined;
  if (!row) {
    const transaction = getArchiveTransaction(database, transactionId);
    if (!transaction) throw new Error(`unknown archive transaction: ${transactionId}`);
    if (transaction.status !== "processing") throw new Error(`archive transaction is not processing: ${transaction.status}`);
    throw new Error("archive transaction is claimed by another worker");
  }
  return { transaction: getArchiveTransaction(database, transactionId)!, request: JSON.parse(row.request_json) as ArchiveSubmission };
}

export const archiveTransactionTransitionSchema = z.object({
  status: z.enum(["processing", "succeeded", "failed", "partial"]),
  occurredAt: z.iso.datetime({ offset: true }),
  summary: z.string().trim().min(1).max(2_000).optional(),
  gitCommit: z.string().trim().min(1).max(120).optional(),
  errorSummary: z.string().trim().min(1).max(2_000).optional(),
}).strict().superRefine((transition, context) => {
  if (transition.status === "processing" && (transition.gitCommit || transition.errorSummary)) context.addIssue({ code: "custom", message: "processing transitions cannot be terminal" });
  if (transition.status === "succeeded" && transition.errorSummary) context.addIssue({ code: "custom", path: ["errorSummary"], message: "successful transactions cannot have an error summary" });
  if (transition.status === "failed" && !transition.errorSummary) context.addIssue({ code: "custom", path: ["errorSummary"], message: "failed transactions require an error summary" });
});

export function transitionArchiveTransaction(database: FeatherDatabase, transactionId: string, value: unknown): ArchiveTransaction {
  const transition = archiveTransactionTransitionSchema.parse(value);
  const current = getArchiveTransaction(database, transactionId);
  if (!current) throw new Error(`unknown archive transaction: ${transactionId}`);
  if (current.status === transition.status) return current;
  const allowed = current.status === "pending"
    ? new Set<ArchiveTransaction["status"]>(["processing", "failed"])
    : current.status === "processing"
      ? new Set<ArchiveTransaction["status"]>(["succeeded", "failed", "partial"])
      : new Set<ArchiveTransaction["status"]>();
  if (!allowed.has(transition.status)) throw new Error(`invalid archive transaction transition: ${current.status} -> ${transition.status}`);
  const terminal = transition.status !== "processing";
  const result = database.prepare(`
    UPDATE archive_transactions SET status=?, processing_started_at=CASE WHEN ?='processing' THEN ? ELSE processing_started_at END,
      completed_at=?, summary=?, git_commit=?, error_summary=?
    WHERE transaction_id=? AND status=?
  `).run(
    transition.status,
    transition.status,
    transition.occurredAt,
    terminal ? transition.occurredAt : null,
    transition.summary ?? null,
    transition.gitCommit ?? null,
    transition.errorSummary ?? null,
    transactionId,
    current.status,
  );
  if (result.changes !== 1) throw new Error("archive transaction changed concurrently");
  return getArchiveTransaction(database, transactionId)!;
}
