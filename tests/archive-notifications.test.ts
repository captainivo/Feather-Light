import { describe, expect, it } from "vitest";
import { acknowledgeArchiveCompletionNotification, claimNextArchiveCompletionNotification, enqueueArchiveCompletionNotification } from "../src/archive-notifications.js";
import { migrate, openDatabase } from "../src/database.js";
import { parseArchiveSubmission } from "../src/story-archive-contract.js";
import { recordArchiveSubmission } from "../src/archive-transactions.js";

describe("archive completion notification outbox", () => {
  it("leases one body-free receipt and acknowledges it idempotently", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const transactionId = recordArchiveSubmission(database, parseArchiveSubmission({
      submission_id: "notification-001", mode: "archive", source_client: "test",
      submitted_at: "2026-08-16T18:00:00Z", content: "private content", requested_status: "draft",
    })).transaction.transactionId;
    const created = enqueueArchiveCompletionNotification(database, {
      transactionId, transactionStatus: "succeeded", noteId: "note-001", noteTitle: "Example",
      mode: "archive", canonStatus: "draft", relativePath: "Example.md",
      gitRevision: "abc123", completedAt: "2026-08-16T18:01:00Z",
    });
    expect(JSON.stringify(created)).not.toContain("private content");
    expect(claimNextArchiveCompletionNotification(database, {
      workerId: "n8n-email", occurredAt: "2026-08-16T18:02:00Z", leaseSeconds: 60,
    })).toEqual(created);
    expect(claimNextArchiveCompletionNotification(database, {
      workerId: "other", occurredAt: "2026-08-16T18:02:30Z", leaseSeconds: 60,
    })).toBeNull();
    expect(acknowledgeArchiveCompletionNotification(database, created.notificationId, {
      workerId: "n8n-email", occurredAt: "2026-08-16T18:02:40Z",
    })).toEqual(created);
    expect(claimNextArchiveCompletionNotification(database, {
      workerId: "other", occurredAt: "2026-08-16T18:03:01Z", leaseSeconds: 60,
    })).toBeNull();
  });
});
