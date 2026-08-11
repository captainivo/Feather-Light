import { describe, expect, it } from "vitest";
import { approveArchiveTransactionProposal, prepareArchiveTransactionProposal } from "../src/archive-proposals.js";
import { claimNextArchiveTransaction, recordArchiveSubmission } from "../src/archive-transactions.js";
import { migrate, openDatabase } from "../src/database.js";
import { parseArchiveSubmission } from "../src/story-archive-contract.js";

function fixture() {
  const database = openDatabase(":memory:");
  migrate(database);
  const submission = parseArchiveSubmission({
    submission_id: "proposal-test-001", mode: "archive", source_client: "mithra-hermes",
    submitted_at: "2026-08-10T12:00:00-07:00", content: "Synthetic proposal content.", requested_status: "draft",
  });
  const transactionId = recordArchiveSubmission(database, submission).transaction.transactionId;
  claimNextArchiveTransaction(database, { workerId: "n8n-main", occurredAt: "2026-08-10T19:01:00Z" });
  const proposal = {
    workerId: "n8n-main", preparedAt: "2026-08-10T19:02:00Z", proposalVersion: 1 as const,
    rootId: "westpole-canonical", operation: "NEW" as const,
    note: {
      id: "person-example-001", title: "Example", type: "person", status: "draft" as const,
      primaryCategory: "character", secondaryCategories: [], relativePath: "Characters/Example.md",
      sourceHash: null, content: "---\nid: person-example-001\n---\n# Example\nSynthetic proposal content.\n",
    },
  };
  return { database, transactionId, proposal };
}

describe("archive transaction proposals", () => {
  it("binds an immutable proposal to the claiming worker and exact hash", () => {
    const { database, transactionId, proposal } = fixture();
    const prepared = prepareArchiveTransactionProposal(database, transactionId, proposal);
    expect(prepared.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepareArchiveTransactionProposal(database, transactionId, proposal)).toEqual(prepared);
    expect(() => prepareArchiveTransactionProposal(database, transactionId, { ...proposal, note: { ...proposal.note, title: "Changed" } })).toThrow("different proposal");
  });

  it("approves only the exact proposal hash with durable provenance", () => {
    const { database, transactionId, proposal } = fixture();
    const prepared = prepareArchiveTransactionProposal(database, transactionId, proposal);
    expect(() => approveArchiveTransactionProposal(database, transactionId, {
      proposalHash: "0".repeat(64), approvedBy: "captain-ivo", approvedAt: "2026-08-10T19:03:00Z",
    })).toThrow("hash does not match");
    const approved = approveArchiveTransactionProposal(database, transactionId, {
      proposalHash: prepared.proposalHash, approvedBy: "captain-ivo", approvedAt: "2026-08-10T19:03:00Z",
    });
    expect(approved).toMatchObject({ approvedBy: "captain-ivo", approvedAt: "2026-08-10T19:03:00Z" });
  });
});
