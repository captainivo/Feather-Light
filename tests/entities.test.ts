import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { entityDuplicateCandidates, listEntities, rebuildEntities } from "../src/entities.js";
import { ingestRoot } from "../src/ingest.js";

describe("deterministic entities", () => {
  it("uses explicit types and aliases while flagging collisions", () => {
    const base = join(process.env.TMPDIR ?? "/tmp", `feather-light-entities-${crypto.randomUUID()}`);
    const root = join(base, "archive");
    mkdirSync(join(root, "03 - Characters"), { recursive: true });
    mkdirSync(join(root, "05 - Places"), { recursive: true });
    writeFileSync(
      join(root, "03 - Characters", "Mithra.md"),
      "---\ntype: character\naliases: [Mith]\ncanon: developing\n---\n# Mithra\n",
      "utf8",
    );
    writeFileSync(
      join(root, "05 - Places", "Mith.md"),
      "---\ntype: place\naliases: [Mithra]\n---\n# Mith\n",
      "utf8",
    );
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

    expect(rebuildEntities(database)).toMatchObject({ entities: 2, aliases: 2, duplicateCandidates: 1 });
    expect(listEntities(database, "Person")[0]).toMatchObject({
      entityType: "Person",
      canonicalLabel: "Mithra",
      aliases: ["Mith"],
      reviewStatus: "accepted",
    });
    expect(entityDuplicateCandidates(database)).toHaveLength(1);
    database.close();
  });
});
