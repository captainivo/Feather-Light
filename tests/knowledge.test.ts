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
    mkdirSync(join(root, "06 - Systems"), { recursive: true });
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
    writeFileSync(
      join(root, "06 - Systems", "Servits.md"),
      "---\ntype: system\ncanon: developing\n---\n# Servits\n## Summary\nServits were military organisms.\n## Core Idea\nServits are the mechanization of death.\n## Construction\nThey were weapons. Servits were built from:\n\n- cremated remains of dead Thorin,\n- refined dead steel,\n\nMillions of dead colonists became part of their foundation.\n## Form\nServits resembled skeletal predators. They were stored in dark fluid.\n## Wailing Beneath The Ships\nWorkers claimed to hear:\n\n- metallic anguish\n## Legacy\nMost Servits were destroyed. Some may have disappeared into the miasma.\n## Open Questions\n- [ ] Could a Servit be healed?\n",
      "utf8",
    );
    const config: Config = {
      server: { host: "127.0.0.1", port: 8765 },
      database: { path: join(base, "index.sqlite3") },
      aauthora: { baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 },
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "qwen3:4b-instruct", temperature: 1.1, contextWindow: 4_096, timeoutMs: 60_000, archiveSample: 3 },
      environment: { timezone: "America/Vancouver", masterSeed: "aauthora-canonical-seed-v1", simulationStartDate: "2026-07-16", startingAbsoluteDay: 1 },
      archiveRoots: [{ rootId: "westpole", displayName: "Westpole", path: root, readOnly: true, enabled: true }],
      limits: { maxFileBytes: 1_048_576, searchResults: 10, excerptCharacters: 1_200, responseCharacters: 16_000 },
    };
    const database = openDatabase(config.database.path);
    migrate(database);
    ingestRoot(database, config, "westpole");

    expect(rebuildKnowledge(database)).toMatchObject({
      entities: 3,
      definitions: 4,
      relationships: 2,
      unresolvedLinks: 1,
      ambiguousLinks: 0,
      assertions: 9,
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
    expect(getEntityAssertions(database, "Thorin")).toMatchObject({
      status: "ok",
      fallback: "preferred_definition",
      total: 1,
      coverage: {
        level: "definition_only",
        structuredAssertionCount: 0,
        eligibleSectionCount: 0,
      },
      assertions: [{
        predicate: "archive_definition",
        claimText: "The Thorin are a people of Aauthora.",
        knowledgeStatus: "unknown",
        confidence: 0.65,
        extractionRule: "definition_fallback.heading.summary",
      }],
    });
    const servitFacts = getEntityAssertions(database, "Servits") as {
      total: number;
      coverage: { level: string; structuredAssertionCount: number; eligibleSectionCount: number; sourceSectionCount: number };
      assertions: Array<{ predicate: string; claimText: string; knowledgeStatus: string; confidence: number; extractionRule: string }>;
    };
    expect(servitFacts).toMatchObject({
      total: 8,
      coverage: {
        level: "structured",
        structuredAssertionCount: 8,
        eligibleSectionCount: 4,
        sourceSectionCount: 8,
      },
    });
    expect(servitFacts.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        claimText: "Servits were built from cremated remains of dead Thorin.",
        knowledgeStatus: "unconfirmed",
        extractionRule: "heading.construction.bullet",
      }),
      expect.objectContaining({
        claimText: "Millions of dead colonists became part of their foundation.",
        predicate: "archive_claim",
      }),
      expect.objectContaining({
        claimText: "Workers claimed to hear metallic anguish.",
        predicate: "archive_report",
        knowledgeStatus: "reported",
        confidence: 0.65,
      }),
      expect.objectContaining({
        claimText: "Some may have disappeared into the miasma.",
        predicate: "archive_speculation",
        knowledgeStatus: "speculation",
        confidence: 0.4,
      }),
    ]));
    expect(servitFacts.assertions.some((assertion) => assertion.claimText.includes("healed"))).toBe(false);
    const conciseServitFacts = getEntityAssertions(database, "Servits", 4) as {
      assertions: Array<{ sourceHeading: string }>;
    };
    expect(new Set(conciseServitFacts.assertions.map((assertion) => assertion.sourceHeading)).size).toBe(4);
    database.close();
  });
});
