import { sha256 } from "./hash.js";

const wordPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const wikilinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

function markdownBody(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("unterminated YAML frontmatter");
  return normalized.slice(end + 5);
}

function visibleText(body: string): string {
  let fence: { marker: string; length: number } | null = null;
  return body.split("\n").map((line) => {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1]![0]!;
      if (!fence) fence = { marker, length: match[1]!.length };
      else if (fence.marker === marker && match[1]!.length >= fence.length) fence = null;
      return "";
    }
    return fence ? "" : line;
  }).join("\n");
}

function wordFrequency(body: string): Map<string, number> {
  const readable = visibleText(body).replace(wikilinkPattern, (_whole, target: string, display: string | undefined) => display ?? target);
  const words = readable.normalize("NFKC").toLocaleLowerCase("en").match(wordPattern) ?? [];
  const frequencies = new Map<string, number>();
  for (const word of words) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  return frequencies;
}

function linkFrequency(body: string): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const match of visibleText(body).matchAll(wikilinkPattern)) {
    const target = match[1]!.normalize("NFKC").replaceAll(/\s+/g, " ").trim().toLocaleLowerCase("en");
    frequencies.set(target, (frequencies.get(target) ?? 0) + 1);
  }
  return frequencies;
}

function frequencyDelta(before: Map<string, number>, after: Map<string, number>): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    if (delta > 0) added += delta;
    else removed -= delta;
  }
  return { added, removed };
}

export type SuggestedArchiveAction = "NEW" | "EXPAND" | "REVISE" | "REORGANIZE" | "LINK" | null;

export interface ArchiveContentDiff {
  sourceHash: string;
  targetHash: string;
  bodyHashBefore: string;
  bodyHashAfter: string;
  wordsBefore: number;
  wordsAfter: number;
  wordsAdded: number;
  wordsRemoved: number;
  netWords: number;
  grossWordsChanged: number;
  linksAdded: number;
  linksRemoved: number;
  suggestedAction: SuggestedArchiveAction;
  metadataOnly: boolean;
}

export function computeArchiveContentDiff(beforeText: string, afterText: string): ArchiveContentDiff {
  const beforeBody = markdownBody(beforeText);
  const afterBody = markdownBody(afterText);
  const beforeWords = wordFrequency(beforeBody);
  const afterWords = wordFrequency(afterBody);
  const words = frequencyDelta(beforeWords, afterWords);
  const links = frequencyDelta(linkFrequency(beforeBody), linkFrequency(afterBody));
  const wordsBefore = [...beforeWords.values()].reduce((sum, count) => sum + count, 0);
  const wordsAfter = [...afterWords.values()].reduce((sum, count) => sum + count, 0);
  const bodyHashBefore = sha256(beforeBody);
  const bodyHashAfter = sha256(afterBody);
  const metadataOnly = bodyHashBefore === bodyHashAfter && sha256(beforeText) !== sha256(afterText);
  let suggestedAction: SuggestedArchiveAction;
  if (beforeBody.trim() === "" && afterBody.trim() !== "") suggestedAction = "NEW";
  else if (metadataOnly || bodyHashBefore === bodyHashAfter) suggestedAction = null;
  else if (words.added === 0 && words.removed === 0 && (links.added > 0 || links.removed > 0)) suggestedAction = "LINK";
  else if (words.added > 0 && words.removed === 0) suggestedAction = "EXPAND";
  else if (words.added === 0 && words.removed === 0) suggestedAction = "REORGANIZE";
  else suggestedAction = "REVISE";
  return {
    sourceHash: sha256(beforeText), targetHash: sha256(afterText), bodyHashBefore, bodyHashAfter,
    wordsBefore, wordsAfter, wordsAdded: words.added, wordsRemoved: words.removed,
    netWords: wordsAfter - wordsBefore, grossWordsChanged: words.added + words.removed,
    linksAdded: links.added, linksRemoved: links.removed, suggestedAction, metadataOnly,
  };
}
