import { describe, expect, it } from "vitest";
import { approveArchiveTransactionProposal, prepareArchiveTransactionProposal } from "../src/archive-proposals.js";
import { claimNextArchiveTransaction, recordArchiveSubmission } from "../src/archive-transactions.js";
import { assertArchiveWriterLease, claimNextApprovedArchiveProposal } from "../src/archive-writer-queue.js";
import { migrate, openDatabase } from "../src/database.js";
import { parseArchiveSubmission } from "../src/story-archive-contract.js";

function approvedFixture() {
  const database = openDatabase(":memory:");
  migrate(database);
  const submission = parseArchiveSubmission({ submission_id: "writer-lease-001", mode: "archive", source_client: "test",
    submitted_at: "2026-08-10T19:00:00Z", content: "Synthetic.", requested_status: "draft" });
  const transactionId = recordArchiveSubmission(database, submission).transaction.transactionId;
  claimNextArchiveTransaction(database, { workerId: "n8n-main", occurredAt: "2026-08-10T19:01:00Z" });
  const proposal = prepareArchiveTransactionProposal(database, transactionId, {
    workerId: "n8n-main", preparedAt: "2026-08-10T19:02:00Z", proposalVersion: 1, rootId: "westpole-canonical", operation: "NEW",
    note: { id: "person-lease-001", title: "Lease", type: "person", status: "draft", primaryCategory: "character",
      secondaryCategories: [], relativePath: "Characters/Lease.md", sourceHash: null, content: "---\nid: person-lease-001\n---\n" },
  });
  approveArchiveTransactionProposal(database, transactionId, {
    proposalHash: proposal.proposalHash, approvedBy: "captain-ivo", approvedAt: "2026-08-10T19:03:00Z",
  });
  return { database, transactionId };
}

describe("archive writer queue", () => {
  it("leases approved work once and permits takeover only after expiry", () => {
    const { database, transactionId } = approvedFixture();
    const first = claimNextApprovedArchiveProposal(database, {
      workerId: "writer-one", occurredAt: "2026-08-10T19:04:00Z", leaseSeconds: 60,
    });
    expect(first).toMatchObject({ writerClaimedBy: "writer-one", writerLeaseUntil: "2026-08-10T19:05:00.000Z" });
    expect(claimNextApprovedArchiveProposal(database, {
      workerId: "writer-two", occurredAt: "2026-08-10T19:04:30Z", leaseSeconds: 60,
    })).toBeNull();
    expect(() => assertArchiveWriterLease(database, transactionId, "writer-two", "2026-08-10T19:04:30Z")).toThrow("not leased");
    expect(claimNextApprovedArchiveProposal(database, {
      workerId: "writer-two", occurredAt: "2026-08-10T19:05:00Z", leaseSeconds: 60,
    })).toMatchObject({ writerClaimedBy: "writer-two" });
  });
});
