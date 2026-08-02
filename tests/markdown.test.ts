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
});
