import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "deployment/hermes-skills/granite-archive";

describe("granite-archive Hermes skill", () => {
  it("declares a bounded, approval-first archive workflow", () => {
    const skill = readFileSync(`${root}/SKILL.md`, "utf8");
    expect(skill).toContain("name: granite-archive");
    expect(skill).toContain("explicit author approval");
    expect(skill).toContain("Never treat a successful intake response as proof that canon was written");
    expect(skill).toContain("GRANITE_ARCHIVE_TOKEN_FILE");
    expect(skill).not.toMatch(/Westpole1|Bearer [A-Za-z0-9_-]{12,}/);
  });

  it("validates a normalized request without reading a token or contacting n8n", () => {
    const directory = mkdtempSync(join(tmpdir(), "granite-archive-test-"));
    const request = join(directory, "request.json");
    writeFileSync(request, JSON.stringify({
      submission_id: "mithra-test-001",
      mode: "capture",
      source_client: "mithra-hermes",
      submitted_at: "2026-08-10T12:00:00-07:00",
      content: "Synthetic test material only.",
      requested_status: "draft",
      targets: [],
      categories: ["test"],
      metadata: {},
    }), { mode: 0o600 });
    const client = `${root}/scripts/archivectl`;
    chmodSync(client, 0o755);
    const output = JSON.parse(execFileSync(client, ["validate", request], { encoding: "utf8" })) as Record<string, unknown>;
    expect(output).toEqual({ status: "locally_valid", persisted: false, submission_id: "mithra-test-001" });
  });
});
