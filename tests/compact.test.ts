import { describe, expect, it } from "vitest";
import { compactAssertionResponse, compactEntityResponse, compactSearchResults, compactTimelineEvents } from "../src/compact.js";

const longHash = "a".repeat(64);

describe("compact response projections", () => {
  it("removes search hashes and ranking details while retaining bounded provenance", () => {
    const result = compactSearchResults([{
      sectionId: "sec_1",
      sourceFileId: "src_1",
      title: "Aanu-Kathara",
      relativePath: "05 - Places/Aanu-Kathara.md",
      headingPath: "Aanu-Kathara > Summary",
      startLine: 18,
      endLine: 23,
      sourceHash: longHash,
      sectionHash: longHash,
      excerpt: "## Summary\n\n**[[Aanu-Kathara]]** was the capital city.",
      score: -10.2,
    }]);
    expect(result).toEqual([{
      id: "sec_1",
      title: "Aanu-Kathara",
      heading: "Aanu-Kathara > Summary",
      excerpt: "Aanu-Kathara was the capital city.",
      source: { path: "05 - Places/Aanu-Kathara.md", lines: [18, 23] },
    }]);
    expect(JSON.stringify(result)).not.toContain(longHash);
    expect(JSON.stringify(result)).not.toContain("score");
  });

  it("returns a definition-first entity without relationship payloads", () => {
    const result = compactEntityResponse({
      status: "ok",
      entity: {
        entityId: "ent_1", canonicalLabel: "Aanu-Kathara", entityType: "Place",
        relativePath: "05 - Places/Aanu-Kathara.md", canonStatus: "developing",
        confidence: 1, reviewStatus: "accepted", classificationReason: "frontmatter",
      },
      definition: {
        text: "Aanu-Kathara was the capital city.", kind: "source_derived",
        confidence: 0.96, reviewStatus: "accepted", sourceHeading: "Aanu-Kathara > Summary",
        startLine: 18, endLine: 23, sourceHash: longHash,
      },
      relationships: [{ relationshipId: "rel_1", targetLabel: "Aanu" }],
      relationCount: 17,
      truncated: true,
    });
    expect(result).toMatchObject({
      status: "ok",
      entity: { id: "ent_1", label: "Aanu-Kathara", type: "Place" },
      definition: { text: "Aanu-Kathara was the capital city." },
      relationCount: 17,
    });
    expect(JSON.stringify(result)).not.toContain("relationships");
    expect(JSON.stringify(result)).not.toContain(longHash);
  });

  it("deduplicates fact provenance into a source table", () => {
    const result = compactAssertionResponse({
      status: "ok",
      entity: { entityId: "ent_1", canonicalLabel: "Second Civilization", entityType: "Civilization" },
      assertions: [1, 2].map((index) => ({
        assertionId: `ast_${index}`,
        predicate: "archive_claim",
        claimText: `Claim ${index}`,
        canonStatus: "developing",
        knowledgeStatus: "unconfirmed",
        confidence: 0.75,
        reviewStatus: "accepted",
        extractionRule: "heading.known_facts.bullet",
        sourceSectionId: "sec_shared",
        sourceHeading: "Second Civilization > Known Facts",
        startLine: 21,
        endLine: 32,
        relativePath: "04 - Civilizations and Peoples/Second Civilization.md",
        sourceHash: longHash,
      })),
      total: 2,
      truncated: false,
      coverage: { level: "structured", structuredAssertionCount: 2, eligibleSectionCount: 1, sourceSectionCount: 4 },
    });
    expect(result).toMatchObject({
      status: "ok",
      assertions: [
        { id: "ast_1", kind: "archive_claim", claim: "Claim 1", sourceId: "sec_shared" },
        { id: "ast_2", kind: "archive_claim", claim: "Claim 2", sourceId: "sec_shared" },
      ],
      sources: [{ id: "sec_shared" }],
      coverage: { level: "structured", structuredAssertionCount: 2 },
    });
    expect((result as { sources: object[] }).sources).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(longHash);
  });

  it("keeps unknown timeline dates explicit while removing duplicate keys", () => {
    const result = compactTimelineEvents([{
      eventId: "evt_1",
      eventKey: "fall of aanu-kathara",
      label: "Fall of Aanu-Kathara",
      eventSequence: 3450,
      sequenceIsCanonical: 0,
      oldClockYear: null,
      dateStatus: "unknown",
      dateDisplay: "Unknown",
      timelineAnchor: "4. After Aanu-Kathara",
      observerTime: "unknown",
      canonStatus: "developing",
      relativePath: "07 - Timeline/Uusaiga Timeline.md",
      sourceLine: 45,
    }]);
    expect(result).toEqual([{
      id: "evt_1",
      label: "Fall of Aanu-Kathara",
      sequence: 3450,
      sequenceIsCanonical: 0,
      dateStatus: "unknown",
      date: "Unknown",
      anchor: "4. After Aanu-Kathara",
      observerTime: "unknown",
      canonStatus: "developing",
      source: { path: "07 - Timeline/Uusaiga Timeline.md", line: 45 },
    }]);
  });
});
