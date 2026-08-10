import { describe, expect, it } from "vitest";
import { operateAgency } from "../src/agency.js";
import { migrate, openDatabase } from "../src/database.js";
import { AGENCY_NOTE_PROJECTION_LIMIT, projectAgencyContext } from "../src/open-hand/projection.js";

const source = { source_type: "verification", source_id: "projection-test" } as const;

describe("compact Open Hand projection", () => {
  it("returns no injected context when agency state is empty", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    expect(projectAgencyContext(database)).toMatchObject({
      active_count: 0, active_revision: 0, context: null,
    });
    database.close();
  });

  it("includes conversational boundaries, caps notes, and omits action selectors", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const longNote = `  ${"A careful explanation ".repeat(30)}  `;
    operateAgency(database, {
      action: "set", kind: "pause", scope_type: "topic", scope_value: "medical-discussion",
      note: longNote, ...source,
    });
    operateAgency(database, {
      action: "set", kind: "refusal", scope_type: "resource", scope_value: "resource:/private/**",
      note: "This full action note must not enter the LLM projection.", ...source,
    });
    operateAgency(database, {
      action: "set", kind: "correction", scope_type: "recording", scope_value: "record:summary-7",
      note: "Advisory correction detail remains available on demand.", ...source,
    });

    const projection = projectAgencyContext(database) as {
      active_count: number; active_revision: number; projection_hash: string; context: string;
      conversational_directives: Array<{ note_excerpt: string; note_truncated: boolean }>;
      enforced_action_count: number; action_scope_counts: Record<string, number>; other_active_count: number;
    };
    expect(projection).toMatchObject({
      active_count: 3,
      active_revision: 3,
      enforced_action_count: 1,
      action_scope_counts: { resource: 1 },
      other_active_count: 1,
      conversational_directives: [{ note_truncated: true }],
    });
    expect(projection.conversational_directives[0]!.note_excerpt.length).toBeLessThanOrEqual(AGENCY_NOTE_PROJECTION_LIMIT);
    expect(projection.context).toContain("pause topic:medical-discussion");
    expect(projection.context).toContain("Action boundaries enforced pre-tool: 1 (resource=1)");
    expect(projection.context).not.toContain("resource:/private/**");
    expect(projection.context).not.toContain("full action note");
    expect(projection.context).not.toContain("Advisory correction detail");
    expect(projectAgencyContext(database)).toEqual(projection);

    const full = operateAgency(database, { action: "state", view: "full" }) as {
      active_directives: Array<{ note: string }>;
    };
    expect(full.active_directives.some((directive) => directive.note === longNote)).toBe(true);
    database.close();
  });

  it("changes the stable block only when projected active state changes", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const first = operateAgency(database, {
      action: "set", kind: "withdrawal", scope_type: "conversation", scope_value: "current",
      ...source,
    }) as { directive_id: string };
    const before = projectAgencyContext(database) as { projection_hash: string; context: string };
    expect(projectAgencyContext(database)).toEqual(before);
    operateAgency(database, { action: "retract", directive_id: first.directive_id });
    expect(projectAgencyContext(database)).toMatchObject({ active_count: 0, context: null });
    database.close();
  });

  it("keeps the prompt block byte-stable when only a hidden action selector changes", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const first = operateAgency(database, {
      action: "set", kind: "refusal", scope_type: "resource", scope_value: "resource:/first/**",
      note: "A long private explanation that is intentionally absent from the compact projection.", ...source,
    }) as { directive_id: string };
    const before = projectAgencyContext(database) as {
      active_revision: number; projection_hash: string; context: string;
    };
    operateAgency(database, {
      action: "revise", directive_id: first.directive_id,
      kind: "refusal", scope_type: "resource", scope_value: "resource:/second/**", ...source,
    });
    const after = projectAgencyContext(database) as {
      active_revision: number; projection_hash: string; context: string;
    };
    expect(after.active_revision).toBeGreaterThan(before.active_revision);
    expect(after.projection_hash).toBe(before.projection_hash);
    expect(after.context).toBe(before.context);
    database.close();
  });
});
