import { basename } from "node:path";
import type { FeatherDatabase } from "./database.js";
import { normalizeEntityLabel } from "./entities.js";
import { stableId } from "./hash.js";

interface TableRow {
  cells: string[];
  sourceLine: number;
}

function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let wikilinkDepth = 0;
  for (let index = 1; index < line.length - 1; index += 1) {
    const pair = line.slice(index, index + 2);
    if (pair === "[[") {
      wikilinkDepth += 1;
      current += pair;
      index += 1;
    } else if (pair === "]]" && wikilinkDepth > 0) {
      wikilinkDepth -= 1;
      current += pair;
      index += 1;
    } else if (line[index] === "|" && wikilinkDepth === 0) {
      cells.push(current.trim());
      current = "";
    } else current += line[index];
  }
  cells.push(current.trim());
  return cells;
}

function tableRows(plainText: string, startLine: number): TableRow[] {
  const lines = plainText.split("\n");
  const rows: TableRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = splitTableCells(line);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    rows.push({ cells, sourceLine: startLine + index });
  }
  return rows.slice(1);
}

function displayText(value: string): string {
  return value
    .replaceAll(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_match, target: string, _heading: string | undefined, display: string | undefined) => display ?? basename(target))
    .replaceAll(/[*_`]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function linkTarget(value: string): string | null {
  const match = value.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/);
  return match?.[1]?.trim() ?? null;
}

function anchor(value: string): string | null {
  const match = value.match(/\[\[[^\]|#]+#([^\]|]+)(?:\|[^\]]+)?\]\]/);
  return match?.[1]?.trim() ?? (displayText(value) || null);
}

export function rebuildChronology(database: FeatherDatabase): {
  periods: number;
  events: number;
  knownOldClockYears: number;
  noncanonicalSequences: number;
} {
  database.transaction(() => {
    database.prepare("DELETE FROM chronology_events").run();
    database.prepare("DELETE FROM chronology_periods").run();
    const timelines = database.prepare(`
      SELECT source_file_id AS sourceFileId, frontmatter_json AS frontmatterJson
      FROM source_files
      WHERE deleted=0 AND lower(json_extract(frontmatter_json, '$.type'))='timeline'
    `).all() as Array<{ sourceFileId: string; frontmatterJson: string }>;
    const insertPeriod = database.prepare(`
      INSERT INTO chronology_periods(
        period_id, timeline_source_file_id, source_section_id, source_line,
        period_order, label, civilizational_status, summary, canon_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEvent = database.prepare(`
      INSERT INTO chronology_events(
        event_id, event_key, label, timeline_source_file_id, source_section_id,
        source_line, event_sequence, sequence_is_canonical, old_clock_year,
        date_status, date_display, timeline_anchor, observer_time, canon_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'unknown', ?)
    `);
    for (const timeline of timelines) {
      const frontmatter = JSON.parse(timeline.frontmatterJson) as Record<string, unknown>;
      const canonStatus = typeof frontmatter.canon === "string" ? frontmatter.canon : null;
      const sections = database.prepare(`
        SELECT section_id AS sectionId, heading_path AS headingPath,
          start_line AS startLine, plain_text AS plainText
        FROM source_sections WHERE source_file_id=? ORDER BY ordinal
      `).all(timeline.sourceFileId) as Array<{
        sectionId: string; headingPath: string; startLine: number; plainText: string;
      }>;
      for (const section of sections) {
        const heading = section.headingPath.split(" > ").at(-1)!.toLocaleLowerCase();
        if (heading === "at a glance") {
          for (const row of tableRows(section.plainText, section.startLine)) {
            if (row.cells.length < 4) continue;
            const order = Number.parseInt(row.cells[0]!, 10);
            if (!Number.isSafeInteger(order)) continue;
            insertPeriod.run(
              stableId("per", `${timeline.sourceFileId}:${row.sourceLine}`),
              timeline.sourceFileId,
              section.sectionId,
              row.sourceLine,
              order,
              displayText(row.cells[1]!),
              displayText(row.cells[2]!),
              displayText(row.cells[3]!),
              canonStatus,
            );
          }
        }
        if (heading === "event index" || heading === "event sequence cross-reference") {
          for (const row of tableRows(section.plainText, section.startLine)) {
            if (row.cells.length < 4) continue;
            const sequence = Number.parseInt(row.cells[0]!, 10);
            if (!Number.isSafeInteger(sequence)) continue;
            const oldClock = /^\d+$/.test(row.cells[1]!) ? Number.parseInt(row.cells[1]!, 10) : null;
            const label = displayText(row.cells[2]!);
            const target = linkTarget(row.cells[2]!);
            const eventKey = normalizeEntityLabel(target ?? label);
            insertEvent.run(
              stableId("evt", `${timeline.sourceFileId}:${row.sourceLine}`),
              eventKey,
              label,
              timeline.sourceFileId,
              section.sectionId,
              row.sourceLine,
              sequence,
              oldClock,
              oldClock === null ? "unknown" : "explicit",
              oldClock === null ? "Unknown" : `Old Clock ${oldClock}`,
              anchor(row.cells[3]!),
              canonStatus,
            );
          }
        }
      }
    }
  })();
  const count = (table: string, where = "") => (database.prepare(`SELECT count(*) AS count FROM ${table} ${where}`).get() as { count: number }).count;
  return {
    periods: count("chronology_periods"),
    events: count("chronology_events"),
    knownOldClockYears: count("chronology_events", "WHERE old_clock_year IS NOT NULL"),
    noncanonicalSequences: count("chronology_events", "WHERE sequence_is_canonical=0"),
  };
}

export function queryChronology(
  database: FeatherDatabase,
  options: { anchor?: string; query?: string; limit?: number; allSources?: boolean } = {},
): object[] {
  const limit = Math.min(options.limit ?? 50, 200);
  const anchorFilter = options.anchor ? `%${options.anchor.toLocaleLowerCase()}%` : null;
  const queryFilter = options.query ? `%${options.query.toLocaleLowerCase()}%` : null;
  const rows = database.prepare(`
    SELECT e.event_id AS eventId, e.event_key AS eventKey, e.label,
      e.event_sequence AS eventSequence,
      e.sequence_is_canonical AS sequenceIsCanonical, e.old_clock_year AS oldClockYear,
      e.date_status AS dateStatus, e.date_display AS dateDisplay,
      e.timeline_anchor AS timelineAnchor, e.observer_time AS observerTime,
      e.canon_status AS canonStatus, f.relative_path AS relativePath,
      e.source_line AS sourceLine, s.heading_path AS sourceHeading
    FROM chronology_events e
    JOIN source_files f ON f.source_file_id=e.timeline_source_file_id
    JOIN source_sections s ON s.section_id=e.source_section_id
    WHERE (? IS NULL OR lower(e.timeline_anchor) LIKE ?)
      AND (? IS NULL OR lower(e.label) LIKE ?)
    ORDER BY e.event_sequence, e.label, e.event_id LIMIT ?
  `).all(anchorFilter, anchorFilter, queryFilter, queryFilter, Math.min(limit * 5, 1_000)) as Array<{ eventKey: string } & object>;
  if (options.allSources) return rows.slice(0, limit);
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.eventKey)) return false;
    seen.add(row.eventKey);
    return true;
  }).slice(0, limit);
}

export function listChronologyPeriods(database: FeatherDatabase, limit = 50): object[] {
  return database.prepare(`
    SELECT p.period_id AS periodId, p.period_order AS periodOrder,
      p.label, p.civilizational_status AS civilizationalStatus,
      p.summary, p.canon_status AS canonStatus,
      f.relative_path AS relativePath, p.source_line AS sourceLine
    FROM chronology_periods p
    JOIN source_files f ON f.source_file_id=p.timeline_source_file_id
    ORDER BY f.relative_path, p.period_order LIMIT ?
  `).all(Math.min(limit, 200)) as object[];
}
