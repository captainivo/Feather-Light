import type { FeatherDatabase } from "./database.js";
import {
  correctMemoryProvenance,
  setMemorySuppression,
  type MemoryProvenanceRow,
} from "./memory-provenance.js";

export interface DerivedRecordProxy {
  peer: string;
  record_key: string;
  /** How the externally returned record is currently classified (what extractor rebuilt). */
  returned_class?: string;
}

export interface ReconciliationFinding {
  peer: string;
  record_key: string;
  ledger_class: string | null;
  returned_class: string | null;
  ledger_suppress: 0 | 1;
  drifts: string[];
  action_taken: "none" | "resuppressed" | "reclassified" | "flagged-for-review";
}

export interface ReconciliationReport {
  checked: number;
  clean: number;
  drift: number;
  records: ReconciliationFinding[];
}

/**
 * M4 reconciliation: compare externally regenerated derived records (e.g. Honcho) against the
 * durable memory-provenance ledger. Defeat "self-healing" by re-applying the registered
 * suppression/reclassification where drift is detected. Never deletes; only suppresses or
 * reclassifies (or flags for explicit review when apply is false).
 */
export function reconcileDerivedRecords(
  database: FeatherDatabase,
  proxies: DerivedRecordProxy[],
  opts: { apply?: boolean } = {},
): ReconciliationReport {
  const apply = opts.apply ?? false;
  const findings: ReconciliationFinding[] = [];
  let clean = 0;
  let drift = 0;

  for (const proxy of proxies) {
    const row = database.prepare(
      "SELECT * FROM memory_provenance WHERE peer=? AND record_key=? ORDER BY updated_at DESC LIMIT 1",
    ).get(proxy.peer, proxy.record_key) as MemoryProvenanceRow | undefined;

    const ledgerClass = row?.provenance_class ?? null;
    const ledgerSuppress = row?.suppress_flag ?? 0;
    const returnedClass = proxy.returned_class ?? null;
    const drifts: string[] = [];

    if (ledgerSuppress === 1) {
      drifts.push("record is suppressed in the ledger but present in derived retrieval");
    }
    if (ledgerClass === "corrected" && returnedClass !== "corrected") {
      drifts.push(`record is corrected in the ledger (from ${row?.corrected_from ?? "?"}) but classified '${returnedClass ?? "?"}' externally`);
    }
    if (row && ledgerClass !== "corrected" && ledgerClass !== returnedClass) {
      drifts.push(`ledger class '${ledgerClass}' disagrees with returned class '${returnedClass ?? "?"}'`);
    }

    let action: ReconciliationFinding["action_taken"] = "none";
    if (drifts.length > 0) {
      drift += 1;
      if (apply && row) {
        let didAction = false;
        if (ledgerSuppress === 1) {
          setMemorySuppression(database, { peer: proxy.peer, record_key: proxy.record_key, suppress: true });
          action = "resuppressed";
          didAction = true;
        }
        if (ledgerClass === "corrected") {
          correctMemoryProvenance(database, { peer: proxy.peer, record_key: proxy.record_key });
          action = didAction ? "flagged-for-review" : "reclassified";
        }
      } else if (row) {
        action = "flagged-for-review";
      }
    } else {
      clean += 1;
    }

    findings.push({
      peer: proxy.peer,
      record_key: proxy.record_key,
      ledger_class: ledgerClass,
      returned_class: returnedClass,
      ledger_suppress: ledgerSuppress,
      drifts,
      action_taken: action,
    });
  }

  return { checked: proxies.length, clean, drift, records: findings };
}
