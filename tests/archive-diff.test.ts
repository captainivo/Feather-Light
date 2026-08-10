import { describe, expect, it } from "vitest";
import { computeArchiveContentDiff } from "../src/archive-diff.js";

describe("deterministic archive content diff", () => {
  it("counts gross and net word changes independently", () => {
    const diff = computeArchiveContentDiff("# Note\nThe old silver tower stood.\n", "# Note\nThe ancient golden tower stood tall.\n");
    expect(diff).toMatchObject({ wordsBefore: 6, wordsAfter: 7, wordsAdded: 3, wordsRemoved: 2, netWords: 1, grossWordsChanged: 5, suggestedAction: "REVISE" });
  });

  it("does not treat reordered prose as new creative word growth", () => {
    const diff = computeArchiveContentDiff("One two three.\n", "Three one two.\n");
    expect(diff).toMatchObject({ wordsAdded: 0, wordsRemoved: 0, netWords: 0, suggestedAction: "REORGANIZE" });
  });

  it("detects link-only changes without counting brackets as words", () => {
    const diff = computeArchiveContentDiff("Angus crossed Alphara.\n", "[[Angus]] crossed [[Alphara]].\n");
    expect(diff).toMatchObject({ wordsAdded: 0, wordsRemoved: 0, linksAdded: 2, linksRemoved: 0, suggestedAction: "LINK" });
  });

  it("excludes frontmatter and fenced code from development metrics", () => {
    const before = "---\nstatus: draft\n---\n# Note\nVisible prose.\n```\nsecret old words\n```\n";
    const after = "---\nstatus: canon\ncategory: lore\n---\n# Note\nVisible prose.\n```\ncompletely changed code words\n```\n";
    expect(computeArchiveContentDiff(before, after)).toMatchObject({ wordsAdded: 0, wordsRemoved: 0, metadataOnly: false, suggestedAction: "REORGANIZE" });
  });

  it("identifies true metadata-only changes and empty-to-content creation", () => {
    const metadata = computeArchiveContentDiff("---\nstatus: draft\n---\nSame body.\n", "---\nstatus: canon\n---\nSame body.\n");
    expect(metadata).toMatchObject({ metadataOnly: true, suggestedAction: null, grossWordsChanged: 0 });
    expect(computeArchiveContentDiff("", "# New Note\nFirst words.\n")).toMatchObject({ suggestedAction: "NEW", wordsAdded: 4 });
  });

  it("counts repeated link occurrences and ignores links inside code fences", () => {
    const diff = computeArchiveContentDiff("", "[[Angus]] and [[Angus]].\n```\n[[Hidden]]\n```\n");
    expect(diff).toMatchObject({ linksAdded: 2 });
  });
});
