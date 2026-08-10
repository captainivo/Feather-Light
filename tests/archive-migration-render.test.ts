import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { sha256 } from "../src/hash.js";
import { renderArchiveMigrationPreview } from "../src/archive-migration-render.js";

function fixture(): { config: Config; note: string; changeSet: Record<string, unknown> } {
  const base = join(process.env.TMPDIR ?? "/tmp", `feather-render-${crypto.randomUUID()}`);
  const root = join(base, "archive");
  mkdirSync(root, { recursive: true });
  const note = join(root, "Note.md");
  const content = "---\n# preserved comment\nlegacy: true\n---\n# Note\nSynthetic body.\n";
  writeFileSync(note, content);
  const core = {
    changeSetVersion: 1, rootId: "test", planHash: "a".repeat(64), readOnly: true,
    files: [{ relativePath: "Note.md", sourceHash: sha256(content), changes: [
      { field: "id", value: "note-example-1234", authority: "mechanical" },
      { field: "title", value: "Note", authority: "mechanical" },
      { field: "type", value: "lore", authority: "approved", reviewer: "Tester", decidedAt: "2026-08-09T12:00:00-07:00" },
      { field: "status", value: "draft", authority: "approved", reviewer: "Tester", decidedAt: "2026-08-09T12:00:00-07:00" },
      { field: "primary_category", value: "lore", authority: "approved", reviewer: "Tester", decidedAt: "2026-08-09T12:00:00-07:00" },
      { field: "categories", value: ["lore"], authority: "approved", reviewer: "Tester", decidedAt: "2026-08-09T12:00:00-07:00" },
      { field: "regions", value: [], authority: "mechanical" }, { field: "eras", value: [], authority: "mechanical" },
      { field: "aliases", value: [], authority: "mechanical" }, { field: "created", value: "unknown", authority: "mechanical" },
      { field: "created_source", value: "legacy-import", authority: "mechanical" },
    ] }],
  };
  const changeSet = { ...core, changeSetHash: sha256(JSON.stringify(core)) };
  const config: Config = {
    server: { host: "127.0.0.1", port: 8765 }, database: { path: join(base, "unused.sqlite3") },
    aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2000 }, ollama: { baseUrl: "http://127.0.0.1:11434", model: "test", temperature: 1, contextWindow: 4096, timeoutMs: 1000, archiveSample: 1 },
    environment: { timezone: "America/Vancouver", masterSeed: "test", simulationStartDate: "2026-01-01", startingAbsoluteDay: 1 },
    archiveRoots: [{ rootId: "test", displayName: "Test", path: root, readOnly: true, enabled: true }], limits: { maxFileBytes: 1048576, searchResults: 10, excerptCharacters: 1200, responseCharacters: 16000 },
  };
  return { config, note, changeSet };
}

describe("archive migration render preview", () => {
  it("renders validated frontmatter in memory while preserving the source file and body", () => {
    const { config, note, changeSet } = fixture();
    const before = { bytes: readFileSync(note), mtime: statSync(note, { bigint: true }).mtimeNs };
    const preview = renderArchiveMigrationPreview(config, changeSet);
    expect(preview.files[0]!.renderedFrontmatter).toContain("# preserved comment");
    expect(preview.files[0]!.targetHash).not.toBe(preview.files[0]!.sourceHash);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(note)).toEqual(before.bytes);
    expect(statSync(note, { bigint: true }).mtimeNs).toBe(before.mtime);
  });

  it("rejects tampered change sets and stale source files", () => {
    const { config, note, changeSet } = fixture();
    const tampered = structuredClone(changeSet) as { files: Array<{ changes: Array<{ value: unknown }> }> } & Record<string, unknown>;
    tampered.files[0]!.changes[0]!.value = "tampered";
    expect(() => renderArchiveMigrationPreview(config, tampered)).toThrow("change set hash does not match");
    writeFileSync(note, `${readFileSync(note, "utf8")}changed\n`);
    expect(() => renderArchiveMigrationPreview(config, changeSet)).toThrow("source changed");
  });
});
