import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { sha256 } from "../src/hash.js";
import { renderArchiveMigrationPreview } from "../src/archive-migration-render.js";
import { applyArchiveMigration } from "../src/archive-migration-apply.js";

function fixture() {
  const root = join(process.env.TMPDIR ?? "/tmp", `feather-apply-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  const note = join(root, "Note.md");
  const content = "# Note\nSynthetic body.\n";
  writeFileSync(note, content);
  const changes = [
    ["id", "note-example-1234"], ["title", "Note"], ["type", "lore"], ["status", "draft"], ["primary_category", "lore"], ["categories", ["lore"]], ["regions", []], ["eras", []], ["aliases", []], ["created", "unknown"], ["created_source", "legacy-import"],
  ].map(([field, value]) => ({ field, value, authority: "mechanical" }));
  const core = { changeSetVersion: 1, rootId: "test", planHash: "a".repeat(64), readOnly: true, files: [{ relativePath: "Note.md", sourceHash: sha256(content), changes }] };
  const changeSet = { ...core, changeSetHash: sha256(JSON.stringify(core)) };
  const config = { archiveRoots: [{ rootId: "test", displayName: "Test", path: root, readOnly: true, enabled: true }] } as Config;
  const preview = renderArchiveMigrationPreview(config, changeSet);
  return { root, note, content, changeSet, preview };
}

describe("transactional archive migration apply", () => {
  it("requires the exact preview confirmation and atomically installs validated content", () => {
    const { root, note, changeSet, preview } = fixture();
    expect(() => applyArchiveMigration({ rootId: "test", rootPath: root, expectedPreviewHash: "0".repeat(64), allowWrite: true }, changeSet, preview)).toThrow("confirmed preview hash");
    const result = applyArchiveMigration({ rootId: "test", rootPath: root, expectedPreviewHash: preview.previewHash, allowWrite: true }, changeSet, preview);
    expect(result).toMatchObject({ status: "applied", filesApplied: 1 });
    expect(sha256(readFileSync(note))).toBe(preview.files[0]!.targetHash);
    expect(readFileSync(note, "utf8")).toContain("Synthetic body.\n");
  });

  it("refuses stale sources before preparing an apply", () => {
    const { root, note, changeSet, preview } = fixture();
    writeFileSync(note, "changed\n");
    expect(() => applyArchiveMigration({ rootId: "test", rootPath: root, expectedPreviewHash: preview.previewHash, allowWrite: true }, changeSet, preview)).toThrow("source changed before apply");
    expect(readFileSync(note, "utf8")).toBe("changed\n");
  });
});
