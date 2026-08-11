import { describe, expect, it } from "vitest";
import { deriveNewArchiveProposal } from "../src/archive-proposal-derive.js";
import { claimNextArchiveTransaction, recordArchiveSubmission } from "../src/archive-transactions.js";
import { migrate, openDatabase } from "../src/database.js";
import { parseArchiveSubmission } from "../src/story-archive-contract.js";

describe("deterministic new archive proposals", () => {
  it("renders exact Markdown only from author-reviewed submission fields", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const request = parseArchiveSubmission({
      submission_id: "derive-new-001", mode: "archive", source_client: "mithra-hermes",
      submitted_at: "2026-08-11T16:30:00-07:00", content: "An exact synthetic account.", requested_status: "draft",
      primary_subject: "Example Person", targets: [], categories: ["character"],
      metadata: { archive_note: { id: "person-example-002", type: "person", primary_category: "character",
        secondary_categories: ["traveller"], relative_path: "Characters/Example Person.md", regions: ["westpole"], eras: [], aliases: ["Example"] } },
    });
    const transactionId = recordArchiveSubmission(database, request).transaction.transactionId;
    claimNextArchiveTransaction(database, { workerId: "n8n-main", occurredAt: "2026-08-11T23:31:00Z" });
    const proposal = deriveNewArchiveProposal(database, transactionId, {
      workerId: "n8n-main", preparedAt: "2026-08-11T23:32:00Z", rootId: "westpole-canonical",
    });
    expect(proposal.proposal).toMatchObject({ operation: "NEW", note: {
      id: "person-example-002", relativePath: "Characters/Example Person.md", primaryCategory: "character",
      secondaryCategories: ["traveller"], sourceHash: null,
    } });
    expect(proposal.proposal.note.content).toContain("created: 2026-08-11");
    expect(proposal.proposal.note.content).toContain("# Example Person\n\nAn exact synthetic account.\n");
    expect(proposal.proposalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses non-archive modes and incomplete archive identity", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const request = parseArchiveSubmission({ submission_id: "derive-new-002", mode: "capture", source_client: "test",
      submitted_at: "2026-08-11T23:30:00Z", content: "Synthetic.", requested_status: "draft", metadata: {} });
    const transactionId = recordArchiveSubmission(database, request).transaction.transactionId;
    claimNextArchiveTransaction(database, { workerId: "n8n-main", occurredAt: "2026-08-11T23:31:00Z" });
    expect(() => deriveNewArchiveProposal(database, transactionId, {
      workerId: "n8n-main", preparedAt: "2026-08-11T23:32:00Z", rootId: "westpole-canonical",
    })).toThrow("requires archive mode");
  });
});
