import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { getArchiveTransactionProposal, type ArchiveProposalCore } from "./archive-proposals.js";
import { getArchiveTransaction, transitionArchiveTransaction } from "./archive-transactions.js";
import { recordArchiveNoteChange } from "./archive-ledger.js";
import { sha256 } from "./hash.js";
import { parseMarkdown } from "./markdown.js";
import { storyNoteMetadataSchema } from "./story-archive-contract.js";
import { assertArchiveWriterLease } from "./archive-writer-queue.js";

export interface ArchiveWriteAuthorization {
  allowWrite: true;
  transactionId: string;
  proposalHash: string;
  workerId: string;
  occurredAt: string;
}

export interface ArchiveWriteResult {
  status: "succeeded";
  transactionId: string;
  proposalHash: string;
  noteId: string;
  relativePath: string;
  targetHash: string;
  gitCommit: string;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function validateProposalContent(content: string, note: ArchiveProposalCore["note"]): void {
  const parsed = parseMarkdown(note.id, note.title, content);
  const metadata = storyNoteMetadataSchema.parse(parsed.frontmatter);
  if (metadata.id !== note.id || metadata.title !== note.title || metadata.type !== note.type || metadata.status !== note.status) {
    throw new Error("proposal content frontmatter does not match approved note identity");
  }
  if (metadata.primary_category !== note.primaryCategory) throw new Error("proposal primary category does not match approved note metadata");
  const expectedCategories = [note.primaryCategory, ...note.secondaryCategories].sort();
  if (JSON.stringify([...metadata.categories].sort()) !== JSON.stringify(expectedCategories)) {
    throw new Error("proposal categories do not match approved note metadata");
  }
}

export function applyApprovedArchiveProposal(
  database: FeatherDatabase,
  config: Config,
  authorization: ArchiveWriteAuthorization,
): ArchiveWriteResult {
  if (!authorization.allowWrite) throw new Error("explicit archive write authorization is required");
  const transaction = getArchiveTransaction(database, authorization.transactionId);
  if (!transaction) throw new Error(`unknown archive transaction: ${authorization.transactionId}`);
  if (transaction.status !== "processing") throw new Error("archive write requires a processing transaction");
  const stored = getArchiveTransactionProposal(database, authorization.transactionId);
  if (!stored || !stored.approvedAt || !stored.approvedBy) throw new Error("archive proposal is not approved");
  assertArchiveWriterLease(database, authorization.transactionId, authorization.workerId, authorization.occurredAt);
  if (stored.proposalHash !== authorization.proposalHash) throw new Error("write authorization hash does not match approved proposal");
  const { proposal } = stored;
  const root = config.archiveRoots.find((candidate) => candidate.enabled && candidate.rootId === proposal.rootId);
  if (!root) throw new Error(`unknown or disabled archive root: ${proposal.rootId}`);
  validateProposalContent(proposal.note.content, proposal.note);

  const rootPath = realpathSync(root.path);
  const targetPath = join(rootPath, proposal.note.relativePath);
  if (relative(rootPath, targetPath).startsWith("..")) throw new Error("archive proposal path escapes root");
  const parentPath = realpathSync(dirname(targetPath));
  if (parentPath !== rootPath && !relative(rootPath, parentPath).startsWith("..")) {
    // The real parent remains inside the approved root.
  } else if (parentPath !== rootPath) throw new Error("archive proposal parent escapes root");

  const existed = existsSync(targetPath);
  if (proposal.operation === "NEW" && existed) throw new Error("new-note proposal target already exists");
  if (proposal.operation !== "NEW" && !existed) throw new Error("existing-note proposal target is missing");
  let beforeContent = "";
  let mode = 0o640;
  if (existed) {
    const stat = lstatSync(targetPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("archive proposal target is not a regular file");
    beforeContent = readFileSync(targetPath, "utf8");
    mode = stat.mode & 0o777;
    if (sha256(beforeContent) !== proposal.note.sourceHash) throw new Error("archive proposal source changed before apply");
  }

  const repositoryRoot = realpathSync(git(rootPath, ["rev-parse", "--show-toplevel"]));
  if (repositoryRoot !== rootPath) throw new Error("archive root must be the Git repository root");
  if (git(repositoryRoot, ["status", "--porcelain", "--", proposal.note.relativePath]) !== "") {
    throw new Error("archive proposal target already has uncommitted Git changes");
  }

  const temporary = join(parentPath, `.feather-light-${authorization.transactionId}.tmp`);
  const backup = join(parentPath, `.feather-light-${authorization.transactionId}.bak`);
  const descriptor = openSync(temporary, "wx", mode);
  try {
    writeFileSync(descriptor, proposal.note.content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  let installed = false;
  let committedGit: string | null = null;
  try {
    if (existed) renameSync(targetPath, backup);
    renameSync(temporary, targetPath);
    installed = true;
    git(repositoryRoot, ["add", "--", proposal.note.relativePath]);
    git(repositoryRoot, [
      "-c", "user.name=Feather-Light Archive Writer",
      "-c", "user.email=archive-writer@feather-light.local",
      "commit", "-m", `archive: ${proposal.operation.toLowerCase()} ${proposal.note.id}`,
      "--", proposal.note.relativePath,
    ]);
    const gitCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
    committedGit = gitCommit;
    const targetHash = sha256(proposal.note.content);
    database.transaction(() => {
      recordArchiveNoteChange(database, authorization.transactionId, {
        eventId: `ANE-${authorization.transactionId}`,
        noteId: proposal.note.id,
        filePath: proposal.note.relativePath,
        title: proposal.note.title,
        type: proposal.note.type,
        status: proposal.note.status,
        occurredAt: authorization.occurredAt,
        action: proposal.operation === "DISCARD" ? "REVISE" : proposal.operation,
        beforeContent,
        afterContent: proposal.note.content,
        gitCommit,
        actor: stored.approvedBy,
        primaryCategory: proposal.note.primaryCategory,
        secondaryCategories: proposal.note.secondaryCategories,
        metadata: { proposal_hash: stored.proposalHash, approved_at: stored.approvedAt },
      });
      transitionArchiveTransaction(database, authorization.transactionId, {
        status: "succeeded", occurredAt: authorization.occurredAt,
        summary: `${proposal.operation} ${proposal.note.id} committed at ${proposal.note.relativePath}.`, gitCommit,
      });
    })();
    if (existed) rmSync(backup);
    return {
      status: "succeeded", transactionId: authorization.transactionId, proposalHash: stored.proposalHash,
      noteId: proposal.note.id, relativePath: proposal.note.relativePath, targetHash, gitCommit,
    };
  } catch (error) {
    if (committedGit) {
      try {
        transitionArchiveTransaction(database, authorization.transactionId, {
          status: "partial", occurredAt: authorization.occurredAt, gitCommit: committedGit,
          summary: "Archive Git commit succeeded but ledger finalization requires reconciliation.",
          errorSummary: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        });
      } catch { /* preserve the committed archive and surface the original error */ }
    } else {
      try { git(repositoryRoot, ["reset", "--quiet", "--", proposal.note.relativePath]); } catch { /* best effort index cleanup */ }
      if (installed && existed && existsSync(backup)) {
        rmSync(targetPath, { force: true });
        renameSync(backup, targetPath);
      } else if (installed && !existed) rmSync(targetPath, { force: true });
    }
    throw error;
  } finally {
    rmSync(temporary, { force: true });
    rmSync(backup, { force: true });
  }
}
