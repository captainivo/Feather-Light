import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/database.js";
import {
  correctMemoryProvenance,
  evaluateMemoryAdmission,
  recordMemoryProvenance,
  setMemorySuppression,
} from "../src/memory-provenance.js";

describe("memory provenance ledger", () => {
  it("applies the 021 migration and creates the table", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((r) => r.name)).toContain("memory_provenance");
    db.close();
  });

  it("records an initial class and treats a differing class as a correction chain", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const first = recordMemoryProvenance(db, {
      peer: "ai", record_key: "obs:1", provenance_class: "narrated",
    });
    expect(first).toMatchObject({ created: true, provenance_class: "narrated" });
    const second = recordMemoryProvenance(db, {
      peer: "ai", record_key: "obs:1", provenance_class: "corrected",
    });
    expect(second).toMatchObject({ created: false, provenance_class: "corrected" });
    const row = db.prepare("SELECT * FROM memory_provenance WHERE peer='ai' AND record_key='obs:1'").get() as Record<string, unknown>;
    expect(row.corrected_from).toBe("narrated");
    db.close();
  });

  it("rejects an invalid provenance class (classify-or-refuse)", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(() => recordMemoryProvenance(db, {
      peer: "ai", record_key: "obs:x", provenance_class: "definitely-real",
    })).toThrow(/must be one of/);
    db.close();
  });

  it("suppress_flag hides a record from derived retrieval via admission", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    recordMemoryProvenance(db, { peer: "ai", record_key: "obs:s", provenance_class: "literal" });
    setMemorySuppression(db, { peer: "ai", record_key: "obs:s", suppress: true, correction_note: "scrubbed" });
    const admission = evaluateMemoryAdmission(db, {
      peer: "ai", record_key: "obs:s", proposed_class: "literal",
    });
    expect(admission.allowed).toBe(false);
    expect(admission.suppressed).toBe(true);
    expect(admission.suggested_class).toBe("corrected");
    db.close();
  });

  it("refuses a corrected record's original class (defeats regeneration)", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    recordMemoryProvenance(db, { peer: "ai", record_key: "obs:c", provenance_class: "literal" });
    correctMemoryProvenance(db, { peer: "ai", record_key: "obs:c", correction_note: "narrated Void scene" });
    const admission = evaluateMemoryAdmission(db, {
      peer: "ai", record_key: "obs:c", proposed_class: "literal",
    });
    expect(admission.allowed).toBe(false);
    expect(admission.suggested_class).toBe("literal"); // corrected_from
    expect(admission.denied_reason).toMatch(/corrected to/);
    db.close();
  });

  it("admits an unknown record and persists its proposed class", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const admission = evaluateMemoryAdmission(db, {
      peer: "user", record_key: "obs:new", proposed_class: "quoted",
    });
    expect(admission.allowed).toBe(true);
    expect(admission.suppressed).toBe(false);
    expect(admission.provenance?.provenance_class).toBe("quoted");
    db.close();
  });
});
