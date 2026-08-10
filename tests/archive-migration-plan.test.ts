import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { planArchiveMigration } from "../src/archive-migration-plan.js";

function fixture(): { config: Config; notes: string[] } {
  const base = join(process.env.TMPDIR ?? "/tmp", `feather-plan-${crypto.randomUUID()}`);
  const root = join(base, "archive");
  const characters = join(root, "03 - Characters");
  const sources = join(root, "99 - Source Notes");
  mkdirSync(characters, { recursive: true });
  mkdirSync(sources, { recursive: true });
  const notes = [join(characters, "Angus.md"), join(sources, "Raw Note.md")];
  writeFileSync(notes[0]!, "---\ntype: planetary system\ncanon: developing\naliases: The Black Thorin\nera: Third Civilization / Fourth Civilization\n---\n# Angus\n");
  writeFileSync(notes[1]!, "# Raw Note\nUnclassified source.\n");
  return {
    notes,
    config: {
      server: { host: "127.0.0.1", port: 8765 },
      database: { path: join(base, "unused.sqlite3") },
      aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b-instruct", temperature: 1.1, contextWindow: 4_096, timeoutMs: 60_000, archiveSample: 3 },
      environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
      archiveRoots: [{ rootId: "westpole", displayName: "Westpole", path: root, readOnly: true, enabled: true }],
      limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
    },
  };
}

describe("Phase 0.5 migration batch planner", () => {
  it("proposes conservative mappings and leaves canon decisions for review", () => {
    const { config, notes } = fixture();
    const before = notes.map((path) => ({ bytes: readFileSync(path), mtime: statSync(path, { bigint: true }).mtimeNs }));
    const plan = planArchiveMigration(config, "westpole", 20);
    expect(plan).toMatchObject({ totalEligibleFiles: 2, plannedFiles: 2, remainingFiles: 0 });
    const character = plan.files.find((file) => file.relativePath.endsWith("Angus.md"))!;
    expect(character.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "type", value: "planetary-system", level: "review" }),
      expect.objectContaining({ field: "status", value: "draft", source: "canon", level: "review" }),
      expect.objectContaining({ field: "aliases", value: ["The Black Thorin"], level: "review" }),
      expect.objectContaining({ field: "created", value: null, level: "manual" }),
    ]));
    const source = plan.files.find((file) => file.relativePath.endsWith("Raw Note.md"))!;
    expect(source.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "type", value: "source-note", source: "directory", level: "review" }),
      expect.objectContaining({ field: "primary_category", value: "source", level: "review" }),
    ]));
    for (const [index, path] of notes.entries()) {
      expect(readFileSync(path)).toEqual(before[index]!.bytes);
      expect(statSync(path, { bigint: true }).mtimeNs).toBe(before[index]!.mtime);
    }
  });

  it("creates a deterministic bounded first batch", () => {
    const { config } = fixture();
    const first = planArchiveMigration(config, "westpole", 1);
    const repeated = planArchiveMigration(config, "westpole", 1);
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ plannedFiles: 1, remainingFiles: 1 });
  });
});
