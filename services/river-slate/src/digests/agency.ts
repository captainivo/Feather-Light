import type { FeatherDatabase } from "../db.js";
import { activeDirectivesByKind, openHandRepairs } from "../readers/agency.js";
import type { AgencyDigest } from "../types.js";

export function buildAgencyDigest(db: FeatherDatabase): AgencyDigest {
  const directives = activeDirectivesByKind(db);
  const repairs = openHandRepairs(db);
  return {
    directives: {
      active: directives.active,
      by_kind: directives.byKind,
    },
    open_hand: {
      pending: repairs.pending,
      applied: repairs.applied,
    },
  };
}

