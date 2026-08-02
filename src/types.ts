export interface Section {
  sectionId: string;
  headingPath: string;
  headingLevel: number;
  ordinal: number;
  startLine: number;
  endLine: number;
  sectionHash: string;
  plainText: string;
  wikilinks: Wikilink[];
}

export interface Wikilink {
  target: string;
  targetHeading: string | null;
  displayText: string | null;
}

export interface ParsedMarkdown {
  title: string;
  frontmatter: Record<string, unknown>;
  sections: Section[];
}

export interface IngestResult {
  ingestId: string;
  rootId: string;
  status: "complete" | "partial" | "failed";
  filesSeen: number;
  filesOpened: number;
  bytesRead: number;
  recordsChanged: number;
  errors: string[];
  dryRun: boolean;
}

