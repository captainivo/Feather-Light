import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { findDuplicates } from "../src/duplicates.js";
import { ingestRoot } from "../src/ingest.js";

describe("duplicate reporting", () => {
  it("distinguishes identical content from matching titles", () => {
    const base = join(process.env.TMPDIR ?? "/tmp", `feather-light-duplicates-${crypto.randomUUID()}`);
    const root = join(base, "archive");
    mkdirSync(join(root, "source-notes"), { recursive: true });
    writeFileSync(join(root, "Aanu.md"), "# Aanu\nCanonical record\n", "utf8");
    writeFileSync(join(root, "source-notes", "Aanu.md"), "# Aanu\nOlder source note\n", "utf8");
    writeFileSync(join(root, "Aanu Copy.md"), "# Aanu\nCanonical record\n", "utf8");
    const config: Config = {
      server: { host: "127.0.0.1", port: 8765 },
      database: { path: join(base, "index.sqlite3") },
      aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
      environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
      archiveRoots: [{ rootId: "westpole", displayName: "Westpole", path: root, readOnly: true, enabled: true }],
      limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
    };
    const database = openDatabase(config.database.path);
    migrate(database);
    ingestRoot(database, config, "westpole");

    expect(findDuplicates(database, "content")).toHaveLength(1);
    expect(findDuplicates(database, "content")[0]!.files).toHaveLength(2);
    expect(findDuplicates(database, "title")).toHaveLength(1);
    expect(findDuplicates(database, "title")[0]!.files).toHaveLength(3);
    database.close();
  });
});
