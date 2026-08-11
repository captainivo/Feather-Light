import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("versioned n8n workflows", () => {
  it("keeps Story Archive intake inactive and free of committed secrets", () => {
    const raw = readFileSync("n8n/story-archive-intake.json", "utf8");
    const workflow = JSON.parse(raw) as {
      active: boolean;
      nodes: Array<{ name: string; parameters: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }> }>;
    };
    expect(workflow.active).toBe(false);
    expect(workflow.nodes.map((node) => node.name)).toEqual([
      "Receive Submission",
      "Persist With Feather-Light",
      "Return Intake Result",
    ]);
    expect(raw).toContain("FEATHER_LIGHT_BASE_URL");
    expect(raw).toContain("FEATHER_LIGHT_API_TOKEN");
    expect(raw).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
    const webhook = workflow.nodes.find((node) => node.name === "Receive Submission")!;
    expect(webhook.parameters).toMatchObject({ authentication: "headerAuth" });
    expect(webhook.credentials?.httpHeaderAuth).toEqual({ id: "granite-archive-intake", name: "Granite Archive Intake" });
  });

  it("keeps the queue worker inactive, secret-free, and bounded at exact author approval", () => {
    const raw = readFileSync("n8n/story-archive-queue-worker.json", "utf8");
    const workflow = JSON.parse(raw) as { active: boolean; nodes: Array<{ name: string; parameters: Record<string, unknown> }>; connections: Record<string, unknown> };
    expect(workflow.active).toBe(false);
    expect(workflow.nodes.map((node) => node.name)).toEqual([
      "Poll Queue", "Claim Next Transaction", "Transaction Claimed?", "Fetch Claimed Work",
      "Validate Claimed Submission", "Submission Valid?", "Prepare Exact New Note Proposal", "Await Exact Author Approval",
      "Mark Validation Failed", "No Pending Work",
    ]);
    expect(workflow.connections).not.toHaveProperty("Await Exact Author Approval");
    expect(workflow.connections).not.toHaveProperty("Mark Validation Failed");
    expect(raw).toContain("Submission failed deterministic validation at the processing boundary.");
    const parameters = (name: string) => workflow.nodes.find((node) => node.name === name)!.parameters;
    expect(parameters("Claim Next Transaction")).toMatchObject({ options: { response: { response: { fullResponse: true, neverError: true } } } });
    expect(parameters("Fetch Claimed Work")).toMatchObject({ options: {} });
    expect(parameters("Validate Claimed Submission")).toMatchObject({ options: { response: { response: { fullResponse: true, neverError: true } } } });
    expect(raw).toContain("modes: ['archive']");
    expect(raw).toContain("/proposal/derive-new");
    expect(raw).toContain("awaiting_exact_author_approval");
    expect(raw).toContain("FEATHER_LIGHT_WORKER_ID");
    expect(raw).not.toMatch(/Bearer [A-Za-z0-9_-]{12,}/);
  });

  it("sends procedural email only for verified completed archive writes", () => {
    const raw = readFileSync("n8n/story-archive-completion-email.json", "utf8");
    const workflow = JSON.parse(raw) as {
      active: boolean;
      nodes: Array<{ name: string; parameters: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }> }>;
      connections: Record<string, unknown>;
    };
    expect(workflow.active).toBe(false);
    expect(workflow.nodes.map((node) => node.name)).toEqual([
      "Receive Completed Transaction", "Verified Archive Success?", "Email Archive Receipt", "Reject Premature Notification",
    ]);
    const email = workflow.nodes.find((node) => node.name === "Email Archive Receipt")!;
    expect(email.credentials?.smtp).toEqual({ id: "granite-archive-notifications", name: "Granite Archive Notifications" });
    expect(raw).toContain("ARCHIVE_NOTIFICATION_FROM");
    expect(raw).toContain("ARCHIVE_NOTIFICATION_EMAIL");
    expect(raw).toContain("transaction_status");
    expect(raw).toContain("git_revision");
    expect(raw).toContain("private story content is not included");
    expect(raw).not.toContain("content }}");
    expect(raw).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(workflow.connections).not.toHaveProperty("Email Archive Receipt");
  });
});
