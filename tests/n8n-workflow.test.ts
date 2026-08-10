import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("versioned n8n workflows", () => {
  it("keeps Story Archive intake inactive and free of committed secrets", () => {
    const raw = readFileSync("n8n/story-archive-intake.json", "utf8");
    const workflow = JSON.parse(raw) as {
      active: boolean;
      nodes: Array<{ name: string; parameters: Record<string, unknown> }>;
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
  });

  it("keeps the queue worker inactive, secret-free, and bounded at the processing handoff", () => {
    const raw = readFileSync("n8n/story-archive-queue-worker.json", "utf8");
    const workflow = JSON.parse(raw) as { active: boolean; nodes: Array<{ name: string }>; connections: Record<string, unknown> };
    expect(workflow.active).toBe(false);
    expect(workflow.nodes.map((node) => node.name)).toEqual([
      "Poll Queue", "Claim Next Transaction", "Transaction Claimed?", "Fetch Claimed Work",
      "Validate Claimed Submission", "Ready For Processing", "No Pending Work",
    ]);
    expect(workflow.connections).not.toHaveProperty("Ready For Processing");
    expect(raw).toContain("FEATHER_LIGHT_WORKER_ID");
    expect(raw).not.toMatch(/Bearer [A-Za-z0-9_-]{12,}/);
  });
});
