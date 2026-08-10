import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/markdown.js";

describe("parseMarkdown", () => {
  it("preserves frontmatter, headings, line ranges, and wikilinks", () => {
    const parsed = parseMarkdown("src_test", "Fallback", [
      "---",
      "type: character",
      "canon: unconfirmed",
      "---",
      "# Aanu",
      "",
      "## Core Idea",
      "Aanu guides [[Thorin|the Thorin]] on [[Aauthora#History]].",
    ].join("\n"));
    expect(parsed.title).toBe("Aanu");
    expect(parsed.frontmatter.type).toBe("character");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[1]).toMatchObject({ headingPath: "Aanu > Core Idea", startLine: 7, endLine: 8 });
    expect(parsed.sections[1]!.wikilinks).toEqual([
      { target: "Thorin", targetHeading: null, displayText: "the Thorin" },
      { target: "Aauthora", targetHeading: "History", displayText: null },
    ]);
  });

  it("does not create an empty heading from a lone hash", () => {
    const parsed = parseMarkdown("src_test", "Fallback", "# Aanu\n# \n## Core Idea\nMeaning");
    expect(parsed.sections.map((section) => section.headingPath)).toEqual([
      "Aanu",
      "Aanu > Core Idea",
    ]);
  });

  it("keeps section identities stable when unrelated headings are inserted or reordered", () => {
    const before = parseMarkdown("src_test", "Fallback", "# Aanu\n## Core Idea\nMeaning\n## History\nPast");
    const after = parseMarkdown("src_test", "Fallback", "# Preface\nNew\n# Aanu\n## History\nPast\n## Core Idea\nMeaning");
    const idsBefore = new Map(before.sections.map((section) => [section.headingPath, section.sectionId]));
    const idsAfter = new Map(after.sections.map((section) => [section.headingPath, section.sectionId]));
    expect(idsAfter.get("Aanu")).toBe(idsBefore.get("Aanu"));
    expect(idsAfter.get("Aanu > Core Idea")).toBe(idsBefore.get("Aanu > Core Idea"));
    expect(idsAfter.get("Aanu > History")).toBe(idsBefore.get("Aanu > History"));
  });

  it("indexes preamble text but ignores headings and wikilinks inside fenced code", () => {
    const parsed = parseMarkdown("src_test", "Fallback", [
      "A preamble links to [[Visible]].",
      "# Aanu",
      "```md",
      "# False Heading",
      "[[Ghost]]",
      "```",
      "## Real Heading",
      "[[Thorin]]",
    ].join("\n"));
    expect(parsed.sections.map((section) => section.headingPath)).toEqual([
      "Aanu > Preamble", "Aanu", "Aanu > Real Heading",
    ]);
    expect(parsed.sections.flatMap((section) => section.wikilinks).map((link) => link.target)).toEqual([
      "Visible", "Thorin",
    ]);
  });
});
