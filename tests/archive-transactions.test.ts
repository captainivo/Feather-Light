import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import { archiveSubmissionHash, claimNextArchiveTransaction, getArchiveTransaction, getClaimedArchiveTransactionWork, listArchiveTransactions, recordArchiveSubmission, transitionArchiveTransaction } from "../src/archive-transactions.js";
import { parseArchiveSubmission } from "../src/story-archive-contract.js";

const databases: FeatherDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): FeatherDatabase {
  const value = openDatabase(":memory:");
  migrate(value);
  databases.push(value);
  return value;
}

const submission = parseArchiveSubmission({
  submission_id: "SUB-2026-08-10-001",
  mode: "archive",
  source_client: "n8n",
  submitted_at: "2026-08-10T04:00:00Z",
  content: "Archive this source exactly once.",
  requested_status: "draft",
  metadata: { z: 1, a: { second: true, first: true } },
});

describe("archive transaction intake", () => {
  it("stores the complete normalized request as a pending transaction", () => {
    const db = database();
    const result = recordArchiveSubmission(db, submission, "2026-08-10T04:01:00Z");
    expect(result.outcome).toBe("created");
    expect(result.transaction).toMatchObject({
      submissionId: submission.submission_id,
      status: "pending",
      receivedAt: "2026-08-10T04:01:00Z",
    });
    const row = db.prepare("SELECT request_json, request_hash FROM archive_transactions").get() as {
      request_json: string;
      request_hash: string;
    };
    expect(JSON.parse(row.request_json)).toEqual(submission);
    expect(row.request_hash).toBe(archiveSubmissionHash(submission));
  });

  it("returns the original transaction for an identical replay", () => {
    const db = database();
    const first = recordArchiveSubmission(db, submission);
    const second = recordArchiveSubmission(db, submission);
    expect(second.outcome).toBe("replayed");
    expect(second.transaction.transactionId).toBe(first.transaction.transactionId);
    expect((db.prepare("SELECT count(*) AS count FROM archive_transactions").get() as { count: number }).count).toBe(1);
  });

  it("detects reuse of a submission ID with different content", () => {
    const db = database();
    const first = recordArchiveSubmission(db, submission);
    const changed = { ...submission, content: "Different content." };
    const second = recordArchiveSubmission(db, changed);
    expect(second.outcome).toBe("conflict");
    expect(second.transaction.transactionId).toBe(first.transaction.transactionId);
  });

  it("hashes metadata independently of object key order", () => {
    const reordered = parseArchiveSubmission({
      ...submission,
      metadata: { a: { first: true, second: true }, z: 1 },
    });
    expect(archiveSubmissionHash(reordered)).toBe(archiveSubmissionHash(submission));
  });

  it("enforces the pending-processing-terminal transaction lifecycle", () => {
    const db = database();
    const created = recordArchiveSubmission(db, submission).transaction;
    const processing = transitionArchiveTransaction(db, created.transactionId, { status: "processing", occurredAt: "2026-08-10T04:02:00Z", summary: "Deterministic checks started." });
    expect(processing).toMatchObject({ status: "processing", completedAt: null });
    const succeeded = transitionArchiveTransaction(db, created.transactionId, { status: "succeeded", occurredAt: "2026-08-10T04:03:00Z", summary: "Committed one note.", gitCommit: "abc123" });
    expect(succeeded).toMatchObject({ status: "succeeded", completedAt: "2026-08-10T04:03:00Z", gitCommit: "abc123" });
    expect(() => transitionArchiveTransaction(db, created.transactionId, { status: "failed", occurredAt: "2026-08-10T04:04:00Z", errorSummary: "too late" })).toThrow("succeeded -> failed");
  });

  it("requires failure provenance and permits a direct intake failure", () => {
    const db = database();
    const created = recordArchiveSubmission(db, submission).transaction;
    expect(() => transitionArchiveTransaction(db, created.transactionId, { status: "failed", occurredAt: "2026-08-10T04:02:00Z" })).toThrow("require an error summary");
    const failed = transitionArchiveTransaction(db, created.transactionId, { status: "failed", occurredAt: "2026-08-10T04:02:00Z", errorSummary: "Validation dependency unavailable." });
    expect(failed).toMatchObject({ status: "failed", errorSummary: "Validation dependency unavailable." });
  });

  it("lists bounded transactions without returning stored request bodies", () => {
    const db = database();
    const created = recordArchiveSubmission(db, submission).transaction;
    expect(getArchiveTransaction(db, created.transactionId)).toEqual(created);
    const listed = listArchiveTransactions(db, { status: "pending", limit: 1 });
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("requestJson");
  });

  it("atomically claims each pending transaction once in arrival order", () => {
    const db = database();
    const first = recordArchiveSubmission(db, submission, "2026-08-10T04:01:00Z").transaction;
    const secondSubmission = parseArchiveSubmission({ ...submission, submission_id: "SUB-2026-08-10-002" });
    const second = recordArchiveSubmission(db, secondSubmission, "2026-08-10T04:02:00Z").transaction;
    expect(claimNextArchiveTransaction(db, { workerId: "n8n-worker-1", occurredAt: "2026-08-10T04:03:00Z" })).toMatchObject({
      transactionId: first.transactionId, status: "processing", claimedBy: "n8n-worker-1", processingStartedAt: "2026-08-10T04:03:00Z",
    });
    expect(claimNextArchiveTransaction(db, { workerId: "n8n-worker-2", occurredAt: "2026-08-10T04:04:00Z" })).toMatchObject({ transactionId: second.transactionId });
    expect(claimNextArchiveTransaction(db, { workerId: "n8n-worker-3", occurredAt: "2026-08-10T04:05:00Z" })).toBeNull();
  });

  it("claims only explicitly supported modes without consuming other pending work", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    recordArchiveSubmission(db, parseArchiveSubmission({ submission_id: "claim-mode-capture", mode: "capture", source_client: "test",
      submitted_at: "2026-08-11T20:00:00Z", content: "Capture.", requested_status: "draft" }), "2026-08-11T20:00:00Z");
    const archived = recordArchiveSubmission(db, parseArchiveSubmission({ submission_id: "claim-mode-archive", mode: "archive", source_client: "test",
      submitted_at: "2026-08-11T20:01:00Z", content: "Archive.", requested_status: "draft" }), "2026-08-11T20:01:00Z");
    expect(claimNextArchiveTransaction(db, {
      workerId: "archive-only", occurredAt: "2026-08-11T20:02:00Z", modes: ["archive"],
    })?.transactionId).toBe(archived.transaction.transactionId);
    expect(listArchiveTransactions(db, { status: "pending" })).toHaveLength(1);
  });

  it("releases stored source only to the worker holding the claim", () => {
    const db = database();
    const created = recordArchiveSubmission(db, submission).transaction;
    claimNextArchiveTransaction(db, { workerId: "n8n-worker-1", occurredAt: "2026-08-10T04:03:00Z" });
    expect(getClaimedArchiveTransactionWork(db, created.transactionId, "n8n-worker-1").request).toEqual(submission);
    expect(() => getClaimedArchiveTransactionWork(db, created.transactionId, "n8n-worker-2")).toThrow("another worker");
  });
});
