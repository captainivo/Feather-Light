import type { FeatherDatabase } from "../db.js";
import { growthSummary, longingSummary } from "../readers/shelves.js";
import type { ShelvesDigest } from "../types.js";

export function buildShelvesDigest(db: FeatherDatabase): ShelvesDigest {
  const growth = growthSummary(db);
  const longing = longingSummary(db);
  return {
    growth: {
      active: growth.active,
      by_kind: growth.byKind,
    },
    longing: {
      private_held: longing.privateHeld,
      shared_held: longing.sharedHeld,
      released: longing.released,
    },
  };
}

