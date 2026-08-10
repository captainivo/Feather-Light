import { createHash, randomUUID } from "node:crypto";
import type { FeatherDatabase } from "./database.js";
import type { ArchiveSubmission } from "./story-archive-contract.js";

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
      submitted_at, received_at, requested_status, status
    FROM archive_transactions WHERE submission_id = ?
  `).get(submission.submission_id) as TransactionRow | undefined;
  if (!row) throw new Error("archive transaction insert did not produce a readable row");
  const transaction = mapTransaction(row);
  if (result.changes === 1) return { outcome: "created", transaction };
  return row.request_hash === requestHash
    ? { outcome: "replayed", transaction }
    : { outcome: "conflict", transaction };
}
