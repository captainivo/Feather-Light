import { parse as parseYaml } from "yaml";
import { sha256, stableId } from "./hash.js";
import type { ParsedMarkdown, Section, Wikilink } from "./types.js";

const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const wikilinkPattern = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

function frontmatter(lines: string[]): { data: Record<string, unknown>; bodyStart: number } {
  if (lines[0]?.trim() !== "---") return { data: {}, bodyStart: 0 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw new Error("unterminated YAML frontmatter");
  const value = parseYaml(lines.slice(1, end).join("\n")) as unknown;
  if (value === null || value === undefined) return { data: {}, bodyStart: end + 1 };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("frontmatter must be a map");
  return { data: value as Record<string, unknown>, bodyStart: end + 1 };
}

function extractWikilinks(text: string): Wikilink[] {
  return [...text.matchAll(wikilinkPattern)].map((match) => ({
    target: match[1]!.trim(),
    targetHeading: match[2]?.trim() || null,
    displayText: match[3]?.trim() || null,
  }));
}

export function parseMarkdown(sourceFileId: string, fallbackTitle: string, text: string): ParsedMarkdown {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const { data, bodyStart } = frontmatter(lines);
  const headings: { line: number; level: number; title: string }[] = [];
  for (let index = bodyStart; index < lines.length; index += 1) {
    const match = lines[index]!.match(headingPattern);
    const headingTitle = match?.[2]?.trim();
    if (match && headingTitle) {
      headings.push({ line: index, level: match[1]!.length, title: headingTitle });
    }
  }

  const title =
    (typeof data.title === "string" && data.title.trim()) ||
    headings.find((heading) => heading.level === 1)?.title ||
    fallbackTitle;
  const boundaries = headings.length > 0 ? headings : [{ line: bodyStart, level: 0, title }];
  const stack: { level: number; title: string }[] = [];
  const sections: Section[] = [];

  for (let ordinal = 0; ordinal < boundaries.length; ordinal += 1) {
    const heading = boundaries[ordinal]!;
    const next = boundaries[ordinal + 1];
    while (stack.length > 0 && stack.at(-1)!.level >= heading.level) stack.pop();
    if (heading.level > 0) stack.push({ level: heading.level, title: heading.title });
    const startIndex = heading.line;
    const endIndex = next ? next.line - 1 : lines.length - 1;
    const plainText = lines.slice(startIndex, endIndex + 1).join("\n").trim();
    const headingPath = stack.map((entry) => entry.title).join(" > ") || title;
    const sectionId = stableId("sec", `${sourceFileId}:${ordinal}`);
    sections.push({
      sectionId,
      headingPath,
      headingLevel: heading.level,
      ordinal,
      startLine: startIndex + 1,
      endLine: endIndex + 1,
      sectionHash: sha256(plainText),
      plainText,
      wikilinks: extractWikilinks(plainText),
    });
  }

  return { title, frontmatter: data, sections };
}
