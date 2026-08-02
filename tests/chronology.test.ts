import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { listChronologyPeriods, queryChronology, rebuildChronology } from "../src/chronology.js";
import { migrate, openDatabase } from "../src/database.js";
import { ingestRoot } from "../src/ingest.js";

describe("relative chronology", () => {
  it("preserves noncanonical sequence and unknown dates from timeline tables", () => {
    const base = join(process.env.TMPDIR ?? "/tmp", `feather-light-chronology-${crypto.randomUUID()}`);
    const root = join(base, "archive");
    mkdirSync(join(root, "07 - Timeline"), { recursive: true });
    writeFileSync(join(root, "07 - Timeline", "Master Timeline.md"), [
      "---",
      "type: timeline",
      "canon: developing",
      "---",
      "# Master Timeline",
      "## At A Glance",
      "| Order | Era / Period | Status | Movement |",
      "|---:|---|---|---|",
      "| 1 | [[First Civilization]] | Declared | Shared continuity. |",
      "## Event Index",
      "| Seq | Old Clock Year | Event Note | Timeline Anchor |",
      "|---:|---|---|---|",
      "| 1700 | Unknown | [[Source/Aanu Event|Aanu's Event]] | [[Master Timeline#1. First Civilization]] |",
      "| 1800 | 42 | Later Event | [[Master Timeline#1. First Civilization]] |",
    ].join("\n"), "utf8");
    const config: Config = {
      server: { host: "127.0.0.1", port: 8765 },
      database: { path: join(base, "index.sqlite3") },
      aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
      archiveRoots: [{ rootId: "westpole", displayName: "Westpole", path: root, readOnly: true, enabled: true }],
      limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
    };
    const database = openDatabase(config.database.path);
    migrate(database);
    ingestRoot(database, config, "westpole");

    expect(rebuildChronology(database)).toEqual({
      periods: 1,
      events: 2,
      knownOldClockYears: 1,
      noncanonicalSequences: 2,
    });
    expect(queryChronology(database, { query: "Aanu" })[0]).toMatchObject({
      label: "Aanu's Event",
      eventSequence: 1700,
      sequenceIsCanonical: 0,
      dateStatus: "unknown",
      oldClockYear: null,
      timelineAnchor: "1. First Civilization",
      observerTime: "unknown",
    });
    expect(listChronologyPeriods(database)[0]).toMatchObject({
      periodOrder: 1,
      label: "First Civilization",
      civilizationalStatus: "Declared",
    });
    database.close();
  });
});
