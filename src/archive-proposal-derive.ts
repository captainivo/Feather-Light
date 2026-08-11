import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";
import { prepareArchiveTransactionProposal, type ArchiveTransactionProposal } from "./archive-proposals.js";
import { getClaimedArchiveTransactionWork } from "./archive-transactions.js";

const slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const permanentId = z.string().min(3).max(120).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/);

export const deriveNewProposalInputSchema = z.object({
  workerId: slug,
  preparedAt: z.iso.datetime({ offset: true }),
  rootId: slug,
}).strict();

const archiveNoteIntentSchema = z.object({
  id: permanentId,
  type: slug,
  primary_category: slug,
  secondary_categories: z.array(slug).max(50).default([]),
  relative_path: z.string().min(4).max(500)
    .refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes("..") && value.endsWith(".md")),
  regions: z.array(slug).max(50).default([]),
  eras: z.array(slug).max(50).default([]),
  aliases: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
}).strict();

export function deriveNewArchiveProposal(
  database: FeatherDatabase,
  transactionId: string,
  value: unknown,
): ArchiveTransactionProposal {
  const input = deriveNewProposalInputSchema.parse(value);
  const { request } = getClaimedArchiveTransactionWork(database, transactionId, input.workerId);
  if (request.mode !== "archive") throw new Error("deterministic new-note derivation requires archive mode");
  if (!request.primary_subject) throw new Error("new-note derivation requires primary_subject");
  const intent = archiveNoteIntentSchema.parse(request.metadata.archive_note);
  const categories = [intent.primary_category, ...intent.secondary_categories];
  if (new Set(categories).size !== categories.length) throw new Error("archive note categories must be unique");
  const frontmatter = {
    id: intent.id,
    title: request.primary_subject,
    type: intent.type,
    status: request.requested_status,
    primary_category: intent.primary_category,
    categories,
    regions: intent.regions,
    eras: intent.eras,
    aliases: intent.aliases,
    created: request.submitted_at.slice(0, 10),
    created_source: "author-supplied",
  };
  const content = `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n# ${request.primary_subject}\n\n${request.content.trim()}\n`;
  return prepareArchiveTransactionProposal(database, transactionId, {
    workerId: input.workerId,
    preparedAt: input.preparedAt,
    proposalVersion: 1,
    rootId: input.rootId,
    operation: "NEW",
    note: {
      id: intent.id,
      title: request.primary_subject,
      type: intent.type,
      status: request.requested_status,
      primaryCategory: intent.primary_category,
      secondaryCategories: intent.secondary_categories,
      relativePath: intent.relative_path,
      sourceHash: null,
      content,
    },
  });
}
