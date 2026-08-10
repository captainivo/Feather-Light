import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { auditArchiveRoot } from "../src/archive-migration-audit.js";

function fixture(): { config: Config; root: string; paths: string[] } {
  const base = join(process.env.TMPDIR ?? "/tmp", `feather-audit-${crypto.randomUUID()}`);
  const root = join(base, "archive");
  mkdirSync(root, { recursive: true });
  const paths = [join(root, "Complete.md"), join(root, "Legacy.md"), join(root, "Invalid.md")];
  writeFileSync(paths[0]!, [
    "---",
    "id: person-complete-001",
    "title: Complete",
    "type: person",
    "status: canon",
    "primary_category: character",
    "categories: [character]",
    "regions: []",
    "eras: []",
    "aliases: []",
    "created: 2026-08-10",
    "---",
    "# Complete",
  ].join("\n"));
  writeFileSync(paths[1]!, "---\ntype: place\n---\n# Legacy Place\nOriginal prose.\n");
  writeFileSync(paths[2]!, [
    "---",
    "id: Invalid ID",
    "title: Invalid",
    "type: person",
    "status: unknown",
    "primary_category: Character Name",
    "categories: [character, character]",
    "regions: []",
    "eras: []",
    "aliases: []",
    "created: yesterday",
    "---",
    "# Invalid",
  ].join("\n"));
  return {
    root,
    paths,
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

describe("Phase 0.5 archive migration audit", () => {
  it("reports complete, missing, and invalid metadata without changing the vault", () => {
    const { config, paths } = fixture();
    const before = paths.map((path) => ({ bytes: readFileSync(path), mtime: statSync(path, { bigint: true }).mtimeNs }));
    const audit = auditArchiveRoot(config, "westpole");
    expect(audit).toMatchObject({
      auditVersion: 1,
      filesSeen: 3,
      filesOpened: 3,
      readyFiles: 1,
      migrationRequiredFiles: 2,
      errors: [],
    });
    const complete = audit.files.find((file) => file.relativePath === "Complete.md")!;
    expect(complete).toMatchObject({ validMetadata: true, missingFields: [], invalidFields: [], proposedId: null });
    const legacy = audit.files.find((file) => file.relativePath === "Legacy.md")!;
    expect(legacy.validMetadata).toBe(false);
    expect(legacy.missingFields).toContain("id");
    expect(legacy.proposedId).toMatch(/^place-legacy-place-/);
    const invalid = audit.files.find((file) => file.relativePath === "Invalid.md")!;
    expect(invalid.invalidFields.map((issue) => issue.field)).toEqual(expect.arrayContaining(["id", "status", "created", "categories"]));
    for (const [index, path] of paths.entries()) {
      expect(readFileSync(path)).toEqual(before[index]!.bytes);
      expect(statSync(path, { bigint: true }).mtimeNs).toBe(before[index]!.mtime);
    }
  });

  it("produces the same manifest hash for repeated unchanged scans", () => {
    const { config } = fixture();
    expect(auditArchiveRoot(config, "westpole").manifestHash).toBe(auditArchiveRoot(config, "westpole").manifestHash);
  });
});
