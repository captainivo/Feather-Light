import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";
import { applyApprovedArchiveProposal, type ArchiveWriteResult } from "./archive-writer.js";
import { claimNextApprovedArchiveProposal } from "./archive-writer-queue.js";

export interface ArchiveWriterOptions {
  workerId: string;
  leaseSeconds: number;
  pollMilliseconds: number;
}

export function runArchiveWriterIteration(
  database: FeatherDatabase,
  config: Config,
  options: ArchiveWriterOptions,
  occurredAt = new Date().toISOString(),
): ArchiveWriteResult | null {
  const claimed = claimNextApprovedArchiveProposal(database, {
    workerId: options.workerId,
    occurredAt,
    leaseSeconds: options.leaseSeconds,
  });
  if (!claimed) return null;
  return applyApprovedArchiveProposal(database, config, {
    allowWrite: true,
    transactionId: claimed.proposal.transactionId,
    proposalHash: claimed.proposalHash,
    workerId: options.workerId,
    occurredAt,
  });
}

export async function runArchiveWriterDaemon(
  database: FeatherDatabase,
  config: Config,
  options: ArchiveWriterOptions,
  signal?: AbortSignal,
): Promise<void> {
  while (!signal?.aborted) {
    try {
      const result = runArchiveWriterIteration(database, config, options);
      if (result) console.log(JSON.stringify({ component: "archive-writer", event: "committed", ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        component: "archive-writer",
        status: "write_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    try {
      await delay(options.pollMilliseconds, undefined, { signal });
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
  }
}
