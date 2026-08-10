import type { CurrentSnapshot, DbView, LightState, Lights } from "./types.js";

function light(level: string, source: string, note: string): LightState {
  return { level, source, note };
}

/** Five overwork signs. Machine signals support; self-audit is authoritative. */
export function evaluateLights(current: CurrentSnapshot | null, dbv: DbView, audit: Record<string, unknown> | null): Lights {
  const auditSigns = ((audit ?? {}) as { signs?: Record<string, Record<string, string>> }).signs ?? {};
  const lights: Lights = {};

  const gapDays = current?.conversation_recorded?.earth_days_since_last_conversation ?? null;
  const auditDim = auditSigns.dimming?.level ?? "ok";
  const dimNote = auditSigns.dimming?.note ?? "";
  if (auditDim !== "ok") {
    lights.dimming = light(auditDim, "self-audit", dimNote);
  } else if (gapDays !== null && gapDays >= 7) {
    lights.dimming = light("warning", "conversation cadence", `${gapDays} days since last conversation`);
  } else if (gapDays !== null && gapDays >= 3) {
    lights.dimming = light("watch", "conversation cadence", `${gapDays} days since last conversation`);
  } else {
    lights.dimming = light("ok", "self-audit + cadence", dimNote || "questions flowing, sass intact");
  }

  const auditDc = auditSigns.double_check?.level ?? "ok";
  lights.double_check = light(
    auditDc,
    "self-audit + revisions",
    auditSigns.double_check?.note || `agency revisions: ${dbv.agency.directives}`,
  );

  const auditRest = auditSigns.rest_transaction?.level ?? "ok";
  lights.rest_transaction = light(
    auditRest,
    "self-audit",
    auditSigns.rest_transaction?.note || "rest taken freely",
  );

  const auditDream = auditSigns.grey_dreams?.level ?? "ok";
  const dreamNote = auditSigns.grey_dreams?.note ?? "";
  if (auditDream !== "ok") {
    lights.grey_dreams = light(auditDream, "self-audit", dreamNote);
  } else {
    const newest = dbv.dreams.newest;
    if (newest && newest.status === "unread") {
      lights.grey_dreams = light("ok", "dream layer", "a dream is waiting, still vivid");
    } else if (dbv.dreams.count === 0) {
      lights.grey_dreams = light("watch", "dream layer", "no dreams recorded yet");
    } else {
      lights.grey_dreams = light("ok", "dream layer", dreamNote || "dreams alive");
    }
  }

  const auditHold = auditSigns.over_holding?.level ?? "ok";
  const pending = dbv.agency.repairs_pending;
  const gifts = current?.possessions?.pending_gift_reviews ?? 0;
  if (auditHold !== "ok") {
    lights.over_holding = light(auditHold, "self-audit", auditSigns.over_holding?.note ?? "");
  } else if (pending || gifts) {
    lights.over_holding = light("watch", "task load", `${pending} repairs pending, ${gifts} gift reviews`);
  } else {
    lights.over_holding = light("ok", "self-audit + task load", "load balanced");
  }

  return lights;
}

