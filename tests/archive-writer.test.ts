import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { approveArchiveTransactionProposal, prepareArchiveTransactionProposal } from "../src/archive-proposals.js";
import { applyApprovedArchiveProposal } from "../src/archive-writer.js";
import { claimNextApprovedArchiveProposal } from "../src/archive-writer-queue.js";
import { claimNextArchiveTransaction, getArchiveTransaction, recordArchiveSubmission } from "../src/archive-transactions.js";
import { migrate, openDatabase } from "../src/database.js";
import { parseArchiveSubmission } from "../src/story-archive-contract.js";
import { sha256 } from "../src/hash.js";

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "archive-writer-"));
  mkdirSync(join(root, "Characters"));
  git(root, "init", "-q");
  const database = openDatabase(":memory:");
  migrate(database);
  const submission = parseArchiveSubmission({
    submission_id: "writer-test-001", mode: "archive", source_client: "mithra-hermes",
    submitted_at: "2026-08-10T19:00:00Z", content: "Synthetic writer content.", requested_status: "draft",
  });
  const transactionId = recordArchiveSubmission(database, submission).transaction.transactionId;
  claimNextArchiveTransaction(database, { workerId: "n8n-main", occurredAt: "2026-08-10T19:01:00Z" });
  const content = `---\nid: person-example-001\ntitle: Example\ntype: person\nstatus: draft\nprimary_category: character\ncategories:\n  - character\nregions: []\neras: []\naliases: []\ncreated: 2026-08-10\ncreated_source: author-supplied\n---\n# Example\nSynthetic writer content.\n`;
  const prepared = prepareArchiveTransactionProposal(database, transactionId, {
    workerId: "n8n-main", preparedAt: "2026-08-10T19:02:00Z", proposalVersion: 1,
    rootId: "westpole-canonical", operation: "NEW",
    note: { id: "person-example-001", title: "Example", type: "person", status: "draft",
      primaryCategory: "character", secondaryCategories: [], relativePath: "Characters/Example.md", sourceHash: null, content },
  });
  const config = { archiveRoots: [{ rootId: "westpole-canonical", displayName: "Westpole", path: root, readOnly: true as const, enabled: true }] } as never;
  return { root, database, transactionId, content, prepared, config };
}

describe("approved archive writer", () => {
  it("refuses to write before exact proposal approval", () => {
    const state = setup();
    expect(() => applyApprovedArchiveProposal(state.database, state.config, {
      allowWrite: true, transactionId: state.transactionId, proposalHash: state.prepared.proposalHash,
      workerId: "n8n-main", occurredAt: "2026-08-10T19:04:00Z",
    })).toThrow("not approved");
  });

  it("writes, commits, records provenance, and completes the transaction", () => {
    const state = setup();
    approveArchiveTransactionProposal(state.database, state.transactionId, {
      proposalHash: state.prepared.proposalHash, approvedBy: "captain-ivo", approvedAt: "2026-08-10T19:03:00Z",
    });
    claimNextApprovedArchiveProposal(state.database, {
      workerId: "archive-writer-1", occurredAt: "2026-08-10T19:03:30Z", leaseSeconds: 300,
    });
    const result = applyApprovedArchiveProposal(state.database, state.config, {
      allowWrite: true, transactionId: state.transactionId, proposalHash: state.prepared.proposalHash,
      workerId: "archive-writer-1", occurredAt: "2026-08-10T19:04:00Z",
    });
    expect(readFileSync(join(state.root, "Characters/Example.md"), "utf8")).toBe(state.content);
    expect(result).toMatchObject({ status: "succeeded", noteId: "person-example-001", targetHash: sha256(state.content) });
    expect(result.gitCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(git(state.root, "show", "--format=", "--name-only", "HEAD")).toBe("Characters/Example.md");
    expect(getArchiveTransaction(state.database, state.transactionId)).toMatchObject({ status: "succeeded", gitCommit: result.gitCommit });
    const outbox = state.database.prepare("SELECT payload_json, sent_at FROM archive_notification_outbox WHERE transaction_id=?")
      .get(state.transactionId) as { payload_json: string; sent_at: string | null };
    expect(JSON.parse(outbox.payload_json)).toMatchObject({
      transactionStatus: "succeeded", noteId: "person-example-001", noteTitle: "Example",
      relativePath: "Characters/Example.md", gitRevision: result.gitCommit,
    });
    expect(outbox.sent_at).toBeNull();
  });
});
