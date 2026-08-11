import { z } from "zod";
import type { FeatherDatabase } from "./database.js";
import { getArchiveTransactionProposal, type ArchiveTransactionProposal } from "./archive-proposals.js";

const writerClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  occurredAt: z.iso.datetime({ offset: true }),
  leaseSeconds: z.number().int().min(15).max(3_600).default(300),
}).strict();

/** Atomically leases one author-approved proposal to a dedicated archive writer. */
export function claimNextApprovedArchiveProposal(database: FeatherDatabase, value: unknown): ArchiveTransactionProposal | null {
  const claim = writerClaimSchema.parse(value);
  const leaseUntil = new Date(Date.parse(claim.occurredAt) + claim.leaseSeconds * 1_000).toISOString();
  return database.transaction(() => {
    const next = database.prepare(`
      SELECT p.transaction_id
      FROM archive_transaction_proposals p
      JOIN archive_transactions t ON t.transaction_id=p.transaction_id
      WHERE p.approved_at IS NOT NULL AND t.status='processing'
        AND (p.writer_lease_until IS NULL OR p.writer_lease_until <= ?)
      ORDER BY p.approved_at, p.prepared_at, p.transaction_id LIMIT 1
    `).get(claim.occurredAt) as { transaction_id: string } | undefined;
    if (!next) return null;
    const result = database.prepare(`
      UPDATE archive_transaction_proposals
      SET writer_claimed_by=?, writer_claimed_at=?, writer_lease_until=?
      WHERE transaction_id=? AND (writer_lease_until IS NULL OR writer_lease_until <= ?)
    `).run(claim.workerId, claim.occurredAt, leaseUntil, next.transaction_id, claim.occurredAt);
    if (result.changes !== 1) throw new Error("archive writer lease changed concurrently");
    return getArchiveTransactionProposal(database, next.transaction_id)!;
  })();
}

export function assertArchiveWriterLease(
  database: FeatherDatabase,
  transactionId: string,
  workerId: string,
  occurredAt: string,
): ArchiveTransactionProposal {
  const proposal = getArchiveTransactionProposal(database, transactionId);
  if (!proposal) throw new Error(`unknown archive proposal: ${transactionId}`);
  if (proposal.writerClaimedBy !== workerId || !proposal.writerLeaseUntil) throw new Error("archive proposal is not leased to this writer");
  if (proposal.writerLeaseUntil <= occurredAt) throw new Error("archive writer lease has expired");
  return proposal;
}
