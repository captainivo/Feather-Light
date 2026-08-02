import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { migrate, openDatabase } from "../src/database.js";
import { ingestRoot } from "../src/ingest.js";
import { getEntityAssertions, getEntityBrief, rebuildKnowledge } from "../src/knowledge.js";

describe("deterministic knowledge projection", () => {
  it("extracts definitions and conservative wikilink relationships", () => {
    const base = join(process.env.TMPDIR ?? "/tmp", `feather-light-knowledge-${crypto.randomUUID()}`);
    const root = join(base, "archive");
    mkdirSync(join(root, "03 - Characters"), { recursive: true });
    mkdirSync(join(root, "04 - Civilizations and Peoples", "Species"), { recursive: true });
    writeFileSync(
      join(root, "03 - Characters", "Aanu.md"),
      "---\ntype: character\naliases: [The Architect]\ncanon: unconfirmed\npeople: '[[Thorin]]'\n---\n# Aanu\n## Core Idea\n**Aanu** guides the [[Thorin]] and remembers [[Unknown City]].\n## Known Facts\n- Aanu guides the Thorin.\n",
      "utf8",
    );
    writeFileSync(
      join(root, "04 - Civilizations and Peoples", "Species", "Thorin.md"),
      "---\ntype: species\n---\n# Thorin\n## Summary\nThe Thorin are a people of Aauthora.\n",
      "utf8",
    );
    const config: Config = {
      server: { host: "127.0.0.1", port: 8765 },
      database: { path: join(base, "index.sqlite3") },
      archiveRoots: [{ rootId: "westpole", displayName: "Westpole", path: root, readOnly: true, enabled: true }],
      limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
    };
    const database = openDatabase(config.database.path);
    migrate(database);
    ingestRoot(database, config, "westpole");

    expect(rebuildKnowledge(database)).toMatchObject({
      entities: 2,
      definitions: 2,
      relationships: 2,
      unresolvedLinks: 1,
      ambiguousLinks: 0,
      assertions: 1,
      typedRelationships: 1,
    });
    expect(getEntityBrief(database, "The Architect")).toMatchObject({
      status: "ok",
      entity: { canonicalLabel: "Aanu", entityType: "Person" },
      definition: { text: "Aanu guides the Thorin and remembers Unknown City." },
      relationCount: 1,
      relationships: [{ relationType: "associated_with", targetLabel: "Thorin" }],
    });
    expect(getEntityAssertions(database, "Aanu")).toMatchObject({
      status: "ok",
      total: 1,
      assertions: [{ claimText: "Aanu guides the Thorin.", knowledgeStatus: "unconfirmed" }],
    });
    database.close();
  });
});
