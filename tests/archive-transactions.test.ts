import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import { archiveSubmissionHash, recordArchiveSubmission } from "../src/archive-transactions.js";
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
});
