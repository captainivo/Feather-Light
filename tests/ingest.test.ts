import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { ingestRoot } from "../src/ingest.js";
import { search } from "../src/search.js";

const temporary: string[] = [];
afterEach(() => {
  // Test artifacts live in the operating system temp directory and are naturally ephemeral.
  temporary.length = 0;
});

function fixture(): { config: Config; note: string } {
  const base = join(process.env.TMPDIR ?? "/tmp", `feather-light-${crypto.randomUUID()}`);
  const root = join(base, "archive");
  mkdirSync(root, { recursive: true });
  const note = join(root, "Aanu.md");
  writeFileSync(note, "---\ntype: character\n---\n# Aanu\n## Core Idea\nAanu guides [[Thorin]].\n", "utf8");
  temporary.push(base);
  return {
    note,
    config: {
      server: { host: "127.0.0.1", port: 8765 },
      database: { path: join(base, "index.sqlite3") },
      aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
      environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
      archiveRoots: [{ rootId: "westpole", displayName: "Westpole", path: root, readOnly: true, enabled: true }],
      limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1200, responseCharacters: 16_000 },
    },
  };
}

describe("ingestion", () => {
  it("indexes provenance without modifying its source", () => {
    const { config, note } = fixture();
    const before = { bytes: readFileSync(note), mtime: statSync(note, { bigint: true }).mtimeNs };
    const database = openDatabase(config.database.path);
    migrate(database);
    const result = ingestRoot(database, config, "westpole");
    expect(result).toMatchObject({ status: "complete", filesSeen: 1, filesOpened: 1, recordsChanged: 1 });
    expect(search(database, config, "Aanu")[0]).toMatchObject({
      title: "Aanu",
      relativePath: "Aanu.md",
      headingPath: "Aanu > Core Idea",
      startLine: 5,
    });
    expect(readFileSync(note)).toEqual(before.bytes);
    expect(statSync(note, { bigint: true }).mtimeNs).toBe(before.mtime);
    database.close();
  });

  it("does not mark records deleted when the root is unavailable", () => {
    const { config } = fixture();
    const database = openDatabase(config.database.path);
    migrate(database);
    expect(ingestRoot(database, config, "westpole").status).toBe("complete");
    config.archiveRoots[0]!.path = join(config.archiveRoots[0]!.path, "missing");
    expect(ingestRoot(database, config, "westpole").status).toBe("failed");
    const active = database.prepare("SELECT count(*) AS count FROM source_files WHERE deleted = 0").get() as { count: number };
    expect(active.count).toBe(1);
    database.close();
  });
});
