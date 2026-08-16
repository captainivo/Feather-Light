import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FeatherDatabase } from "./database.js";

export interface ArchiveCompletionNotification {
  notificationId: string;
  transactionId: string;
  transactionStatus: "succeeded";
  noteId: string;
  noteTitle: string;
  mode: string;
  canonStatus: string;
  relativePath: string;
  gitRevision: string;
  completedAt: string;
}

const claimSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  occurredAt: z.iso.datetime({ offset: true }),
  leaseSeconds: z.number().int().min(30).max(3_600).default(300),
}).strict();

const acknowledgeSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();

export function enqueueArchiveCompletionNotification(
  database: FeatherDatabase,
  payload: Omit<ArchiveCompletionNotification, "notificationId">,
): ArchiveCompletionNotification {
  const notification: ArchiveCompletionNotification = { notificationId: `ANF-${randomUUID()}`, ...payload };
  database.prepare(`
    INSERT INTO archive_notification_outbox(notification_id, transaction_id, payload_json, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(transaction_id) DO NOTHING
  `).run(notification.notificationId, notification.transactionId, JSON.stringify(notification), notification.completedAt);
  const row = database.prepare(`SELECT payload_json FROM archive_notification_outbox WHERE transaction_id=?`)
    .get(notification.transactionId) as { payload_json: string } | undefined;
  if (!row) throw new Error("archive notification enqueue did not produce a readable row");
  return JSON.parse(row.payload_json) as ArchiveCompletionNotification;
}

export function claimNextArchiveCompletionNotification(
  database: FeatherDatabase,
  value: unknown,
): ArchiveCompletionNotification | null {
  const claim = claimSchema.parse(value);
  return database.transaction(() => {
    const next = database.prepare(`
      SELECT notification_id FROM archive_notification_outbox
      WHERE sent_at IS NULL AND (lease_until IS NULL OR lease_until <= ?)
      ORDER BY created_at, notification_id LIMIT 1
    `).get(claim.occurredAt) as { notification_id: string } | undefined;
    if (!next) return null;
    const leaseUntil = new Date(Date.parse(claim.occurredAt) + claim.leaseSeconds * 1_000).toISOString();
    const updated = database.prepare(`
      UPDATE archive_notification_outbox
      SET claimed_by=?, claimed_at=?, lease_until=?
      WHERE notification_id=? AND sent_at IS NULL AND (lease_until IS NULL OR lease_until <= ?)
    `).run(claim.workerId, claim.occurredAt, leaseUntil, next.notification_id, claim.occurredAt);
    if (updated.changes !== 1) throw new Error("archive notification claim changed concurrently");
    const row = database.prepare(`SELECT payload_json FROM archive_notification_outbox WHERE notification_id=?`)
      .get(next.notification_id) as { payload_json: string };
    return JSON.parse(row.payload_json) as ArchiveCompletionNotification;
  })();
}

export function acknowledgeArchiveCompletionNotification(
  database: FeatherDatabase,
  notificationId: string,
  value: unknown,
): ArchiveCompletionNotification {
  const acknowledgement = acknowledgeSchema.parse(value);
  const row = database.prepare(`
    SELECT payload_json, claimed_by, lease_until, sent_at FROM archive_notification_outbox WHERE notification_id=?
  `).get(notificationId) as { payload_json: string; claimed_by: string | null; lease_until: string | null; sent_at: string | null } | undefined;
  if (!row) throw new Error(`unknown archive notification: ${notificationId}`);
  if (row.sent_at) return JSON.parse(row.payload_json) as ArchiveCompletionNotification;
  if (row.claimed_by !== acknowledgement.workerId) throw new Error("archive notification is claimed by another worker");
  if (!row.lease_until || row.lease_until <= acknowledgement.occurredAt) throw new Error("archive notification lease has expired");
  database.prepare(`UPDATE archive_notification_outbox SET sent_at=?, lease_until=NULL WHERE notification_id=? AND sent_at IS NULL`)
    .run(acknowledgement.occurredAt, notificationId);
  return JSON.parse(row.payload_json) as ArchiveCompletionNotification;
}
