import { z } from "zod";

export const canonStatuses = [
  "canon",
  "probable",
  "draft",
  "speculative",
  "contradicted",
  "retconned",
  "discarded",
] as const;

export const archiveModes = [
  "capture",
  "develop",
  "archive",
  "update",
  "retcon",
  "discard",
  "lookup",
  "report",
] as const;

const permanentId = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/, "must be a lowercase, hyphenated permanent ID");

const normalizedLabel = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug");

const uniqueStrings = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).default([]).superRefine((values, context) => {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      const key = value.toLocaleLowerCase("en");
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "duplicate values are not allowed",
          path: [index],
        });
      }
      seen.add(key);
    }
  });

export const storyNoteMetadataSchema = z.object({
  id: permanentId,
  title: z.string().trim().min(1).max(200),
  type: normalizedLabel,
  status: z.enum(canonStatuses),
  primary_category: normalizedLabel,
  categories: uniqueStrings(normalizedLabel),
  regions: uniqueStrings(normalizedLabel),
  eras: uniqueStrings(normalizedLabel),
  aliases: uniqueStrings(z.string().trim().min(1).max(200)),
  created: z.union([z.iso.date(), z.literal("unknown")]),
  created_source: z.enum(["author-supplied", "git-first-add", "legacy-import"]).optional(),
}).superRefine((metadata, context) => {
  if (metadata.created === "unknown" && metadata.created_source !== "legacy-import") {
    context.addIssue({
      code: "custom",
      path: ["created_source"],
      message: "unknown creation dates require created_source: legacy-import",
    });
  }
});

export const archiveSubmissionSchema = z.object({
  submission_id: z.string().trim().min(1).max(120),
  mode: z.enum(archiveModes),
  source_client: normalizedLabel,
  submitted_at: z.iso.datetime({ offset: true }),
  content: z.string().max(2_000_000),
  requested_status: z.enum(canonStatuses),
  primary_subject: z.string().trim().min(1).max(200).optional(),
  targets: uniqueStrings(permanentId),
  categories: uniqueStrings(normalizedLabel),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((submission, context) => {
  if (["capture", "archive", "update", "retcon", "discard"].includes(submission.mode) && submission.content.trim() === "") {
    context.addIssue({ code: "custom", message: `${submission.mode} requires content`, path: ["content"] });
  }
  if (["update", "retcon"].includes(submission.mode) && submission.targets.length === 0) {
    context.addIssue({ code: "custom", message: `${submission.mode} requires at least one target`, path: ["targets"] });
  }
});

export type StoryNoteMetadata = z.infer<typeof storyNoteMetadataSchema>;
export type ArchiveSubmission = z.infer<typeof archiveSubmissionSchema>;

export function parseStoryNoteMetadata(value: unknown): StoryNoteMetadata {
  return storyNoteMetadataSchema.parse(value);
}

export function parseArchiveSubmission(value: unknown): ArchiveSubmission {
  return archiveSubmissionSchema.parse(value);
}
