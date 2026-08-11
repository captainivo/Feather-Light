import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/database.js";
import {
  correctMemoryProvenance,
  recordMemoryProvenance,
  setMemorySuppression,
} from "../src/memory-provenance.js";
import { reconcileDerivedRecords } from "../src/memory-reconciliation.js";

describe("memory provenance reconciliation", () => {
  it("flags suppressed/corrected records that reappear in derived retrieval", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    recordMemoryProvenance(db, { peer: "ai", record_key: "obs:supp", provenance_class: "literal" });
    setMemorySuppression(db, { peer: "ai", record_key: "obs:supp", suppress: true });
    recordMemoryProvenance(db, { peer: "ai", record_key: "obs:corr", provenance_class: "literal" });
    correctMemoryProvenance(db, { peer: "ai", record_key: "obs:corr", correction_note: "narrated" });
    recordMemoryProvenance(db, { peer: "ai", record_key: "obs:clean", provenance_class: "narrated" });

    const report = reconcileDerivedRecords(db, [
      { peer: "ai", record_key: "obs:supp", returned_class: "literal" },
      { peer: "ai", record_key: "obs:corr", returned_class: "literal" },
      { peer: "ai", record_key: "obs:clean", returned_class: "narrated" },
    ]);

    expect(report.checked).toBe(3);
    expect(report.clean).toBe(1);
    expect(report.drift).toBe(2);
    expect(report.records.find((r) => r.record_key === "obs:supp")?.action_taken).toBe("flagged-for-review");
    expect(report.records.find((r) => r.record_key === "obs:corr")?.drifts.length).toBeGreaterThan(0);
    expect(report.records.find((r) => r.record_key === "obs:clean")?.drifts).toHaveLength(0);
    db.close();
  });

  it("re-applies suppression and correction when apply=true (defeats self-healing)", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    recordMemoryProvenance(db, { peer: "ai", record_key: "obs:s", provenance_class: "literal" });
    setMemorySuppression(db, { peer: "ai", record_key: "obs:s", suppress: true });
    recordMemoryProvenance(db, { peer: "ai", record_key: "obs:c", provenance_class: "literal" });
    correctMemoryProvenance(db, { peer: "ai", record_key: "obs:c" });

    const report = reconcileDerivedRecords(db, [
      { peer: "ai", record_key: "obs:s", returned_class: "literal" },
      { peer: "ai", record_key: "obs:c", returned_class: "literal" },
    ], { apply: true });

    expect(report.records.find((r) => r.record_key === "obs:s")?.action_taken).toBe("resuppressed");
    expect(report.records.find((r) => r.record_key === "obs:c")?.action_taken).toBe("reclassified");
    // Ledger still holds the suppression/reclassification.
    const s = db.prepare("SELECT suppress_flag FROM memory_provenance WHERE record_key='obs:s'").get() as { suppress_flag: number };
    expect(s.suppress_flag).toBe(1);
    db.close();
  });
});
