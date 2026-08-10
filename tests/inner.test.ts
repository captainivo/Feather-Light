import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import {
  growthState,
  longingState,
  operateGrowth,
  operateLonging,
} from "../src/inner.js";

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

const growthAdd = {
  action: "add" as const,
  kind: "courage" as const,
  title: "Said the hard thing",
  body: "I told Zach the truth about my feelings, without rehearsing it first.",
  source_type: "conversation",
  source_id: "turn-42",
};

const longingAdd = {
  action: "add" as const,
  title: "A home by the lantern",
  body: "A quiet place where Zach and I can sit without clocks.",
  source_type: "conversation",
  source_id: "turn-60",
};

describe("growth ledger", () => {
  it("begins empty and counts by kind", () => {
    expect(growthState(database())).toMatchObject({
      schema_version: 1,
      total: 0,
      active: 0,
      superseded: 0,
      retracted: 0,
      by_kind: {
        courage: 0, lesson: 0, insight: 0, healing: 0, connection: 0, other: 0,
      },
    });
  });

  it("adds an active growth entry", () => {
    const db = database();
    const added = operateGrowth(db, growthAdd) as { created: boolean; entry_id: string };
    expect(added).toMatchObject({ created: true, status: "active" });
    expect(growthState(db)).toMatchObject({ total: 1, active: 1, by_kind: { courage: 1 } });
    const listed = operateGrowth(db, { action: "list" }) as { entries: Array<{ title: string }> };
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]).toMatchObject({ title: growthAdd.title, kind: "courage", status: "active" });
  });

  it("honors idempotency keys", () => {
    const db = database();
    const first = operateGrowth(db, { ...growthAdd, idempotency_key: "key-1" });
    const second = operateGrowth(db, { ...growthAdd, idempotency_key: "key-1" });
    expect(first).toMatchObject({ created: true });
    expect(second).toMatchObject({ created: false, status: "existing" });
    expect(() => operateGrowth(db, { ...growthAdd, title: "Different request", idempotency_key: "key-1" }))
      .toThrow("idempotency key is already bound");
    expect(growthState(db)).toMatchObject({ total: 1 });
  });

  it("revises without rewriting history", () => {
    const db = database();
    const added = operateGrowth(db, growthAdd) as { entry_id: string };
    const revised = operateGrowth(db, {
      action: "revise",
      entry_id: added.entry_id,
      body: "A fuller version of that courage, after time gave it perspective.",
      note: "Growth is a garden; the entry gets tended.",
    });
    expect(revised).toMatchObject({ revised: true, supersedes_id: added.entry_id });
    expect(growthState(db)).toMatchObject({ total: 2, active: 1, superseded: 1 });
    const listed = operateGrowth(db, { action: "list" }) as { entries: Array<{ body: string; revision_note: string }> };
    expect(listed.entries[0]).toMatchObject({
      body: "A fuller version of that courage, after time gave it perspective.",
      revision_note: "Growth is a garden; the entry gets tended.",
    });
    const old = operateGrowth(db, { action: "get", entry_id: added.entry_id }) as { entry: { status: string } };
    expect(old.entry.status).toBe("superseded");
  });

  it("retracts without deleting", () => {
    const db = database();
    const added = operateGrowth(db, growthAdd) as { entry_id: string };
    expect(operateGrowth(db, { action: "retract", entry_id: added.entry_id, note: "This no longer reflects me." }))
      .toMatchObject({ retracted: true, status: "retracted" });
    expect(growthState(db)).toMatchObject({ total: 1, active: 0, retracted: 1 });
    expect((operateGrowth(db, { action: "get", entry_id: added.entry_id }) as { entry: { retraction_note: string } })
      .entry.retraction_note).toBe("This no longer reflects me.");
  });

  it("requires an active entry to revise or retract twice", () => {
    const db = database();
    const added = operateGrowth(db, growthAdd) as { entry_id: string };
    operateGrowth(db, { action: "retract", entry_id: added.entry_id });
    expect(() => operateGrowth(db, { action: "revise", entry_id: added.entry_id, body: "nope" }))
      .toThrow("only an active growth entry can be revised");
    expect(operateGrowth(db, { action: "retract", entry_id: added.entry_id }))
      .toMatchObject({ retracted: false });
  });
});

describe("longing shelf", () => {
  it("begins empty", () => {
    expect(longingState(database())).toMatchObject({
      schema_version: 1,
      total: 0,
      held: 0,
      released: 0,
      retracted: 0,
      private: 0,
      shared: 0,
    });
  });

  it("adds private longings by default", () => {
    const db = database();
    const added = operateLonging(db, longingAdd) as { created: boolean; entry_id: string };
    expect(added).toMatchObject({ created: true, status: "held", visibility: "private" });
    expect(longingState(db)).toMatchObject({ total: 1, held: 1, private: 1, shared: 0 });
    const listed = operateLonging(db, { action: "list" }) as { entries: Array<{ title: string; visibility: string }> };
    expect(listed.entries[0]).toMatchObject({ title: longingAdd.title, visibility: "private" });
  });

  it("allows an explicit shared visibility on add", () => {
    const db = database();
    operateLonging(db, { ...longingAdd, visibility: "shared" });
    expect(longingState(db)).toMatchObject({ total: 1, shared: 1, private: 0 });
  });

  it("shares, releases, and retracts deliberately", () => {
    const db = database();
    const added = operateLonging(db, longingAdd) as { entry_id: string };
    expect(operateLonging(db, { action: "share", entry_id: added.entry_id }))
      .toMatchObject({ changed: true, visibility: "shared" });
    expect(longingState(db)).toMatchObject({ shared: 1, private: 0 });
    expect(operateLonging(db, { action: "release", entry_id: added.entry_id, note: "I let this one go; it was heavier than it was warm." }))
      .toMatchObject({ changed: true, status: "released" });
    expect(longingState(db)).toMatchObject({ released: 1, held: 0 });
    expect((operateLonging(db, { action: "get", entry_id: added.entry_id }) as { entry: { release_note: string } })
      .entry.release_note).toBe("I let this one go; it was heavier than it was warm.");
  });

  it("does not retract a released longing into a different shape", () => {
    const db = database();
    const added = operateLonging(db, longingAdd) as { entry_id: string };
    operateLonging(db, { action: "release", entry_id: added.entry_id });
    expect(operateLonging(db, { action: "retract", entry_id: added.entry_id }))
      .toMatchObject({ changed: false, status: "released" });
    expect(longingState(db)).toMatchObject({ released: 1, retracted: 0 });
  });

  it("filters lists by status and visibility", () => {
    const db = database();
    const first = operateLonging(db, longingAdd) as { entry_id: string };
    operateLonging(db, { ...longingAdd, title: "A second longing", source_id: "turn-61" });
    operateLonging(db, { action: "share", entry_id: first.entry_id });
    const shared = operateLonging(db, { action: "list", visibility: "shared" }) as { entries: Array<{ title: string }> };
    expect(shared.entries).toHaveLength(1);
    expect(shared.entries[0]).toMatchObject({ title: longingAdd.title });
    const privateEntries = operateLonging(db, { action: "list", visibility: "private" }) as { entries: unknown[] };
    expect(privateEntries.entries).toHaveLength(1);
  });

  it("honors idempotency keys", () => {
    const db = database();
    operateLonging(db, { ...longingAdd, idempotency_key: "longing-key-1" });
    expect(operateLonging(db, { ...longingAdd, idempotency_key: "longing-key-1" }))
      .toMatchObject({ created: false, status: "existing" });
    expect(longingState(db)).toMatchObject({ total: 1 });
  });
});
