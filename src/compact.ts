import type { SearchResult } from "./search.js";

export type ResponseView = "brief" | "standard";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? value as JsonRecord : {};
}

function compactExcerpt(value: string, maximum = 420): string {
  const plain = value
    .replaceAll(/^#{1,6}\s+.*$/gm, "")
    .replaceAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, display: string | undefined) => display ?? target.split("/").at(-1) ?? target)
    .replaceAll(/[*_`>#]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (plain.length <= maximum) return plain;
  const clipped = plain.slice(0, maximum - 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > maximum / 2 ? boundary : clipped.length).trimEnd()}…`;
}

export function compactSearchResults(results: SearchResult[]): object[] {
  return results.map((result) => ({
    id: result.sectionId,
    title: result.title,
    heading: result.headingPath,
    excerpt: compactExcerpt(result.excerpt),
    source: {
      path: result.relativePath,
      lines: [result.startLine, result.endLine],
    },
  }));
}

export function compactEntityResponse(value: object): object {
  const response = record(value);
  if (response.status !== "ok") return value;
  const entity = record(response.entity);
  const definition = record(response.definition);
  const sourceHeading = definition.sourceHeading;
  const startLine = definition.startLine;
  const endLine = definition.endLine;
  return {
    status: "ok",
    entity: {
      id: entity.entityId,
      label: entity.canonicalLabel,
      type: entity.entityType,
      canonStatus: entity.canonStatus,
      confidence: entity.confidence,
      reviewStatus: entity.reviewStatus,
    },
    definition: response.definition === null ? null : {
      text: definition.text,
      kind: definition.kind,
      confidence: definition.confidence,
      reviewStatus: definition.reviewStatus,
      source: {
        path: entity.relativePath,
        heading: sourceHeading,
        lines: [startLine, endLine],
      },
    },
    relationCount: response.relationCount,
  };
}

export function compactAssertionResponse(value: object): object {
  const response = record(value);
  if (response.status !== "ok") return value;
  const entity = record(response.entity);
  const assertions = Array.isArray(response.assertions) ? response.assertions.map(record) : [];
  const sources = new Map<string, object>();
  const compactAssertions = assertions.map((assertion) => {
    const sourceId = String(assertion.sourceSectionId ?? "unknown");
    if (!sources.has(sourceId)) {
      sources.set(sourceId, {
        id: sourceId,
        path: assertion.relativePath,
        heading: assertion.sourceHeading,
        lines: [assertion.startLine, assertion.endLine],
      });
    }
    return {
      id: assertion.assertionId,
      kind: assertion.predicate,
      claim: assertion.claimText,
      canonStatus: assertion.canonStatus,
      knowledgeStatus: assertion.knowledgeStatus,
      confidence: assertion.confidence,
      reviewStatus: assertion.reviewStatus,
      extractionRule: assertion.extractionRule,
      sourceId,
    };
  });
  return {
    status: "ok",
    entity: {
      id: entity.entityId,
      label: entity.canonicalLabel,
      type: entity.entityType,
    },
    assertions: compactAssertions,
    sources: [...sources.values()],
    total: response.total,
    truncated: response.truncated,
    ...(response.coverage ? { coverage: response.coverage } : {}),
    ...(response.fallback ? { fallback: response.fallback } : {}),
  };
}

export function compactTimelineEvents(values: object[]): object[] {
  return values.map((value) => {
    const event = record(value);
    return {
      id: event.eventId,
      label: event.label,
      sequence: event.eventSequence,
      sequenceIsCanonical: event.sequenceIsCanonical,
      dateStatus: event.dateStatus,
      date: event.dateDisplay,
      anchor: event.timelineAnchor,
      observerTime: event.observerTime,
      canonStatus: event.canonStatus,
      source: {
        path: event.relativePath,
        line: event.sourceLine,
      },
    };
  });
}
