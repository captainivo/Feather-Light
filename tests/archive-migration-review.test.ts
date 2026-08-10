import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { archiveMigrationPlanHash, planArchiveMigration } from "../src/archive-migration-plan.js";
import { createArchiveMigrationReviewTemplate, simulateArchiveMigration } from "../src/archive-migration-review.js";

function fixture(): { config: Config; note: string } {
  const base = join(process.env.TMPDIR ?? "/tmp", `feather-review-${crypto.randomUUID()}`);
  const root = join(base, "archive");
  const directory = join(root, "03 - Characters");
  mkdirSync(directory, { recursive: true });
  const note = join(directory, "Example.md");
  writeFileSync(note, "---\ncanon: developing\n---\n# Example\nSynthetic fixture.\n");
  return {
    note,
    config: {
      server: { host: "127.0.0.1", port: 8765 },
      database: { path: join(base, "unused.sqlite3") },
      aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "test", temperature: 1, contextWindow: 4096, timeoutMs: 1000, archiveSample: 1 },
      environment: { timezone: "America/Vancouver", masterSeed: "test", simulationStartDate: "2026-01-01", startingAbsoluteDay: 1 },
      archiveRoots: [{ rootId: "test", displayName: "Test", path: root, readOnly: true, enabled: true }],
      limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1200, responseCharacters: 16000 },
    },
  };
}

function reviewFor(plan: ReturnType<typeof planArchiveMigration>, action: "approve" | "reject" = "approve") {
  const file = plan.files[0]!;
  return {
    reviewVersion: 1 as const,
    planVersion: 1 as const,
    planHash: archiveMigrationPlanHash(plan),
    rootId: plan.rootId,
    decisions: file.proposals.filter((proposal) => proposal.level !== "mechanical").map((proposal) => ({
      relativePath: file.relativePath,
      sourceHash: file.sourceHash,
      field: proposal.field,
      action,
      reviewer: "fixture-reviewer",
      decidedAt: "2026-08-09T12:00:00-07:00",
    })),
  };
}

describe("archive migration review simulation", () => {
  it("creates an editable pending template for every non-mechanical proposal", () => {
    const { config } = fixture();
    const plan = planArchiveMigration(config, "test");
    const template = createArchiveMigrationReviewTemplate(plan);
    expect(template.decisions.length).toBeGreaterThan(0);
    expect(template.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ action: "pending", proposal: expect.objectContaining({ level: "review" }) })]));
    expect(simulateArchiveMigration(config, plan, template).summary.unresolved).toBe(1);
  });

  it("simulates approved proposals without changing the archive", () => {
    const { config, note } = fixture();
    const plan = planArchiveMigration(config, "test");
    const before = { bytes: readFileSync(note), mtime: statSync(note, { bigint: true }).mtimeNs };
    const result = simulateArchiveMigration(config, plan, reviewFor(plan));
    expect(result).toMatchObject({ readOnly: true, summary: { ready: 1, unresolved: 0, stale: 0, invalid: 0 } });
    expect(readFileSync(note)).toEqual(before.bytes);
    expect(statSync(note, { bigint: true }).mtimeNs).toBe(before.mtime);
  });

  it("keeps unapproved or rejected canon decisions unresolved", () => {
    const { config } = fixture();
    const plan = planArchiveMigration(config, "test");
    expect(simulateArchiveMigration(config, plan, { reviewVersion: 1, planVersion: 1, planHash: archiveMigrationPlanHash(plan), rootId: "test", decisions: [] }).summary.unresolved).toBe(1);
    const rejected = simulateArchiveMigration(config, plan, reviewFor(plan, "reject"));
    expect(rejected.files[0]).toMatchObject({ status: "unresolved" });
    expect(rejected.files[0]!.rejectedFields.length).toBeGreaterThan(0);
  });

  it("refuses stale source content and stale review hashes", () => {
    const { config, note } = fixture();
    const plan = planArchiveMigration(config, "test");
    writeFileSync(note, `${readFileSync(note, "utf8")}changed\n`);
    expect(simulateArchiveMigration(config, plan, reviewFor(plan)).summary.stale).toBe(1);
  });

  it("marks a decision made against a different source hash as stale", () => {
    const { config } = fixture();
    const plan = planArchiveMigration(config, "test");
    const review = reviewFor(plan);
    review.decisions[0]!.sourceHash = "0".repeat(64);
    expect(simulateArchiveMigration(config, plan, review).summary.stale).toBe(1);
  });

  it("rejects a review when any proposal in its bound plan changes", () => {
    const { config } = fixture();
    const plan = planArchiveMigration(config, "test");
    const review = reviewFor(plan);
    plan.files[0]!.proposals[0]!.value = "tampered-value";
    expect(() => simulateArchiveMigration(config, plan, review)).toThrow("review plan hash does not match");
  });

  it("rejects decisions that do not correspond to plan proposals", () => {
    const { config } = fixture();
    const plan = planArchiveMigration(config, "test");
    const file = plan.files[0]!;
    expect(() => simulateArchiveMigration(config, plan, {
      reviewVersion: 1, planVersion: 1, planHash: archiveMigrationPlanHash(plan), rootId: "test", decisions: [{
        relativePath: file.relativePath, sourceHash: file.sourceHash, field: "invented", action: "approve",
        reviewer: "fixture-reviewer", decidedAt: "2026-08-09T12:00:00-07:00",
      }],
    })).toThrow("decision does not match a proposal");
  });
});
