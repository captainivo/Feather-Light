import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  archiveSubmissionSchema,
  parseArchiveSubmission,
  storyNoteMetadataSchema,
} from "../src/story-archive-contract.js";

const note = {
  id: "person-angus-001",
  title: "Angus",
  type: "person",
  status: "canon",
  primary_category: "character",
  categories: ["character", "third-civilization"],
  regions: ["alphara"],
  eras: ["third-civilization"],
  aliases: ["The Black Thorin"],
  created: "2026-08-09",
};

const submission = {
  submission_id: "SUB-2026-08-09-004",
  mode: "archive",
  source_client: "web-ui",
  submitted_at: "2026-08-09T19:54:00-07:00",
  content: "Angus carried the feather cylinder.",
  requested_status: "canon",
};

describe("story archive note metadata", () => {
  it("accepts compact canonical metadata", () => {
    expect(storyNoteMetadataSchema.parse(note)).toEqual(note);
  });

  it("rejects IDs that are not permanent slugs", () => {
    expect(() => storyNoteMetadataSchema.parse({ ...note, id: "Angus" })).toThrow();
  });

  it("rejects duplicate classification values", () => {
    expect(() => storyNoteMetadataSchema.parse({ ...note, categories: ["character", "character"] })).toThrow();
  });

  it.each(["person", "place", "event", "thing"])("validates the %s fixture", (kind) => {
    const path = resolve("tests/fixtures/story-archive", `${kind}.json`);
    expect(storyNoteMetadataSchema.parse(JSON.parse(readFileSync(path, "utf8")))).toBeDefined();
  });
});

describe("normalized archive submission", () => {
  it("fills collection and metadata defaults at the client boundary", () => {
    expect(parseArchiveSubmission(submission)).toMatchObject({
      ...submission,
      targets: [],
      categories: [],
      metadata: {},
    });
  });

  it("requires a permanent target for updates and retcons", () => {
    const result = archiveSubmissionSchema.safeParse({ ...submission, mode: "retcon" });
    expect(result.success).toBe(false);
  });

  it("rejects empty content for write-oriented operations", () => {
    const result = archiveSubmissionSchema.safeParse({ ...submission, mode: "capture", content: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts an update with a permanent target", () => {
    expect(parseArchiveSubmission({
      ...submission,
      mode: "update",
      targets: ["person-angus-001"],
    }).targets).toEqual(["person-angus-001"]);
  });
});
