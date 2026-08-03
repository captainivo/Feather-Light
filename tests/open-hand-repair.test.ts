import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { listChronologyPeriods, queryChronology, rebuildChronology } from "../src/chronology.js";
import { migrate, openDatabase } from "../src/database.js";
import { ingestRoot } from "../src/ingest.js";
import { getEntityAssertions, getEntityBrief, rebuildKnowledge } from "../src/knowledge.js";
import { operateRepair, repairCapabilities } from "../src/open-hand/repair.js";
import { search } from "../src/search.js";

function fixture() {
  const base = join(process.env.TMPDIR ?? "/tmp", `feather-light-repair-${crypto.randomUUID()}`);
  const root = join(base, "archive"); mkdirSync(join(root, "03 - Characters"), { recursive: true }); mkdirSync(join(root, "07 - Timeline"), { recursive: true });
  const note = join(root, "03 - Characters", "Aanu.md");
  writeFileSync(note, ["---", "type: character", "canon: confirmed", "---", "# Aanu", "## Core Idea", "Aanu guides the first outward contact.", "## Known Facts", "- Aanu built the first bridge."].join("\n"), "utf8");
  writeFileSync(join(root, "07 - Timeline", "Master Timeline.md"), [
    "---", "type: timeline", "canon: developing", "---", "# Master Timeline", "## At A Glance",
    "| Order | Era / Period | Status | Movement |", "|---:|---|---|---|", "| 1 | First Civilization | Declared | Shared continuity. |",
    "## Event Index", "| Seq | Old Clock Year | Event Note | Timeline Anchor |", "|---:|---|---|---|", "| 10 | Unknown | Aanu's Event | First Civilization |",
  ].join("\n"), "utf8");
  const config: Config = {
    server: { host: "127.0.0.1", port: 8765 }, database: { path: join(base, "index.sqlite3") },
    aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
    environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
    archiveRoots: [{ rootId: "westpole", displayName: "Westpole", path: root, readOnly: true, enabled: true }],
    limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
  };
  const database = openDatabase(config.database.path); migrate(database); ingestRoot(database, config, "westpole"); rebuildKnowledge(database); rebuildChronology(database);
  return { database, config, note };
}
const source = { source_type: "verification", source_id: "phase-3-test" } as const;

describe("Open Hand repair planning and retrieval suppression", () => {
  it("reports storage-specific authority without claiming automatic deletion", () => {
    const result = repairCapabilities() as { automatic_deletion: boolean; systems: Array<{ storageSystem: string; modes: Record<string, string> }> };
    expect(result.automatic_deletion).toBe(false);
    expect(result.systems.find((system) => system.storageSystem === "feather_light_index")?.modes).toMatchObject({ suppress_retrieval: "native", delete: "unsupported" });
  });

  it("plans separately, confirms exact intent, suppresses retrieval, and reverses cleanly", () => {
    const { database, config, note } = fixture();
    const before = { bytes: readFileSync(note), mtime: statSync(note, { bigint: true }).mtimeNs };
    expect(search(database, config, "Aanu")).not.toHaveLength(0);
    const planned = operateRepair(database, { action: "plan", intent: "suppress_retrieval", storage_system: "feather_light_index", selector_type: "relative_path", selector_value: "03 - Characters/Aanu.md", idempotency_key: "aanu-v1", ...source }) as { repair: { repairId: string; status: string } };
    expect(planned.repair.status).toBe("pending");
    expect(() => operateRepair(database, { action: "apply", repair_id: planned.repair.repairId, confirm_intent: "delete" })).toThrow("confirm_intent");
    expect(operateRepair(database, { action: "apply", repair_id: planned.repair.repairId, confirm_intent: "suppress_retrieval" })).toMatchObject({ applied: true, source_deleted: false });
    expect(search(database, config, "Aanu").some((result) => result.relativePath === "03 - Characters/Aanu.md")).toBe(false);
    expect(getEntityBrief(database, "Aanu")).toMatchObject({ status: "not_found" });
    expect(getEntityAssertions(database, "Aanu")).toMatchObject({ status: "not_found" });
    expect(readFileSync(note)).toEqual(before.bytes); expect(statSync(note, { bigint: true }).mtimeNs).toBe(before.mtime);
    expect(operateRepair(database, { action: "retract", repair_id: planned.repair.repairId })).toMatchObject({ retracted: true });
    expect(getEntityBrief(database, "Aanu")).toMatchObject({ status: "ok" }); database.close();
  });

  it("suppresses section-scoped chronology without deleting it", () => {
    const { database } = fixture(); expect(queryChronology(database, { query: "Aanu" })).toHaveLength(1); expect(listChronologyPeriods(database)).toHaveLength(1);
    const section = database.prepare("SELECT source_section_id AS id FROM chronology_events LIMIT 1").get() as { id: string };
    const planned = operateRepair(database, { action: "plan", intent: "suppress_retrieval", storage_system: "feather_light_index", selector_type: "section_id", selector_value: section.id, ...source }) as { repair: { repairId: string } };
    operateRepair(database, { action: "apply", repair_id: planned.repair.repairId, confirm_intent: "suppress_retrieval" });
    expect(queryChronology(database, { query: "Aanu" })).toHaveLength(0); expect(listChronologyPeriods(database)).toHaveLength(1);
    expect((database.prepare("SELECT count(*) AS count FROM chronology_events").get() as { count: number }).count).toBe(1); database.close();
  });

  it("records unsupported or external repairs without applying them", () => {
    const { database } = fixture();
    const deletion = operateRepair(database, { action: "plan", intent: "delete", storage_system: "provider", selector_type: "record_id", selector_value: "provider-record", ...source }) as { repair: { status: string; capabilityMode: string } };
    expect(deletion.repair).toMatchObject({ status: "rejected", capabilityMode: "unsupported" });
    const invalidNative = operateRepair(database, { action: "plan", intent: "suppress_retrieval", storage_system: "feather_light_index", selector_type: "record_id", selector_value: "not-an-index-selector", ...source }) as { repair: { status: string; capabilityMode: string } };
    expect(invalidNative.repair).toMatchObject({ status: "rejected", capabilityMode: "unsupported" });
    database.close();
  });
});
