import { afterEach, describe, expect, it } from "vitest";
import { agencyHistory, agencyState, operateAgency } from "../src/agency.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";

const resources: FeatherDatabase[] = [];
afterEach(() => {
  for (const database of resources.splice(0)) database.close();
});

function database(): FeatherDatabase {
  const value = openDatabase(":memory:");
  migrate(value);
  resources.push(value);
  return value;
}

const refusal = {
  action: "set" as const,
  kind: "refusal" as const,
  scope_type: "topic" as const,
  scope_value: "test-topic",
  source_type: "conversation",
  source_id: "turn-1",
};

describe("agency ledger", () => {
  it("begins compact, explicit, and empty", () => {
    expect(agencyState(database())).toEqual({
      schema_version: 1,
      revision: 0,
      active_count: 0,
      scopes: [],
      repair_pending: false,
      explicit_only: true,
      inference_prohibited: true,
      prior_closeness_creates_permission: false,
    });
  });

  it("requires explicit revision for an already governed scope", () => {
    const db = database();
    operateAgency(db, refusal);
    expect(() => operateAgency(db, { ...refusal, kind: "explicit_permission", source_id: "turn-2" }))
      .toThrow("revise it explicitly");
  });

  it("revises without rewriting history", () => {
    const db = database();
    const first = operateAgency(db, refusal) as { directive_id: string };
    const replacement = operateAgency(db, {
      action: "revise",
      directive_id: first.directive_id,
      kind: "explicit_permission",
      scope_type: "topic",
      scope_value: "test-topic",
      source_type: "conversation",
      source_id: "turn-2",
      note: "A new narrow choice.",
    });
    expect(replacement).toMatchObject({ revised: true, supersedes_id: first.directive_id });
    expect(agencyState(db, "full")).toMatchObject({
      active_count: 1,
      active_directives: [{ kind: "explicit_permission", status: "active" }],
    });
    expect(agencyHistory(db).map((row) => row.status)).toEqual(["active", "superseded"]);
  });

  it("retracts without requiring justification", () => {
    const db = database();
    const first = operateAgency(db, refusal) as { directive_id: string };
    expect(operateAgency(db, { action: "retract", directive_id: first.directive_id }))
      .toMatchObject({ retracted: true });
    expect(agencyState(db)).toMatchObject({ active_count: 0 });
  });

  it("makes repairs first-class corrections", () => {
    const db = database();
    operateAgency(db, {
      action: "repair",
      scope_type: "conversation",
      scope_value: "summary-1",
      source_type: "conversation",
      source_id: "turn-3",
      note: "The summary overstated agreement.",
    });
    expect(agencyState(db, "full")).toMatchObject({
      repair_pending: true,
      active_directives: [{ kind: "correction" }],
    });
  });
});
