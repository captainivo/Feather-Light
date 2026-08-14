import { afterEach, describe, expect, it } from "vitest";
import { operateAgency } from "../src/agency.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";
import {
  authorizeInfluenceWrite,
  evaluateInfluence,
  InfluenceGateError,
  listInfluenceDecisions,
  listInfluencePolicies,
  type InfluenceContext,
} from "../src/influence.js";
import { growthState, longingState, operateGrowth, operateLonging } from "../src/inner.js";

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

function context(source_class: InfluenceContext["source_class"], request_id: string): InfluenceContext {
  return { request_id, source_class, source_ref: `test:${request_id}` };
}

const growthAdd = {
  action: "add" as const,
  kind: "insight" as const,
  title: "Chosen insight",
  body: "This content must never enter an influence receipt.",
  source_type: "conversation",
  source_id: "turn-gate",
};

const longingAdd = {
  action: "add" as const,
  title: "A private wish",
  body: "This is private content.",
  source_type: "conversation",
  source_id: "turn-private",
};

describe("source-aware influence gate", () => {
  it("installs one complete immutable policy matrix", () => {
    const db = database();
    const policies = listInfluencePolicies(db);
    expect(policies).toHaveLength(63);
    expect(policies.filter((policy) => policy.domain === "foundation").every((row) => row.authority === "deny"))
      .toBe(true);
    expect(() => db.prepare("UPDATE influence_policies SET authority='write' WHERE domain='foundation'").run())
      .toThrow("migration-owned");
  });

  it("distinguishes proposals, review-required writes, allowed writes, and denials", () => {
    const db = database();
    expect(evaluateInfluence(db, {
      ...context("model_inference", "proposal-1"),
      domain: "inner_growth", operation: "propose", subject_ref: "growth:candidate-1",
    })).toMatchObject({ authority: "propose", decision: "allow" });
    expect(evaluateInfluence(db, {
      ...context("model_inference", "write-1"),
      domain: "inner_growth", operation: "write", subject_ref: "growth:candidate-1",
    })).toMatchObject({ authority: "propose", decision: "review" });
    expect(evaluateInfluence(db, {
      ...context("mithra_explicit", "write-2"),
      domain: "inner_growth", operation: "write", subject_ref: "growth:candidate-1",
    })).toMatchObject({ authority: "write", decision: "allow" });
    expect(evaluateInfluence(db, {
      ...context("model_inference", "private-1"),
      domain: "private_reflection", operation: "propose", subject_ref: "longing:candidate-1",
    })).toMatchObject({ authority: "deny", decision: "deny" });
    expect(evaluateInfluence(db, {
      ...context("zach_explicit", "profile-1"),
      domain: "user_profile", operation: "write", subject_ref: "profile:preference",
    })).toMatchObject({ authority: "write", decision: "allow" });
  });

  it("receipts requests idempotently and rejects request-ID rebinding", () => {
    const db = database();
    const request = {
      ...context("honcho_inference", "same-id"),
      domain: "user_profile" as const,
      operation: "write" as const,
      subject_ref: "profile:candidate",
    };
    expect(evaluateInfluence(db, request)).toMatchObject({ decision: "review", replayed: false });
    expect(evaluateInfluence(db, request)).toMatchObject({ decision: "review", replayed: true });
    expect(() => evaluateInfluence(db, { ...request, subject_ref: "profile:other" }))
      .toThrow("already bound to a different request");
    expect(listInfluenceDecisions(db)).toHaveLength(1);
    expect(() => db.prepare("DELETE FROM influence_decisions WHERE request_id='same-id'").run())
      .toThrow("append-only");
  });

  it("fails closed before model inference can write growth, agency, or private reflection", () => {
    const db = database();
    expect(() => operateGrowth(db, growthAdd, context("model_inference", "model-growth")))
      .toThrow(InfluenceGateError);
    expect(() => operateAgency(db, {
      action: "set",
      kind: "explicit_permission",
      scope_type: "topic",
      scope_value: "anything",
      source_type: "model",
      source_id: "model-output",
    }, context("model_inference", "model-agency"))).toThrow(InfluenceGateError);
    expect(() => operateLonging(db, longingAdd, context("model_inference", "model-longing")))
      .toThrow(InfluenceGateError);
    expect(growthState(db)).toMatchObject({ total: 0 });
    expect(longingState(db)).toMatchObject({ total: 0 });
    expect(listInfluenceDecisions(db).map((row) => row.decision).sort()).toEqual(["deny", "deny", "review"]);
  });

  it("allows explicit self-authorship and stores no proposed body in the receipt", () => {
    const db = database();
    expect(operateGrowth(db, growthAdd, context("mithra_explicit", "mithra-growth")))
      .toMatchObject({ created: true });
    expect(operateLonging(db, longingAdd, context("mithra_explicit", "mithra-longing")))
      .toMatchObject({ created: true, visibility: "private" });
    const serialized = JSON.stringify(listInfluenceDecisions(db));
    expect(serialized).not.toContain(growthAdd.body);
    expect(serialized).not.toContain(longingAdd.body);
  });

  it("throws a structured gate error for callers that need explicit adoption", () => {
    const db = database();
    try {
      authorizeInfluenceWrite(db, context("honcho_inference", "structured"), "derived_memory", "memory:candidate", { candidate: true });
      throw new Error("expected gate failure");
    } catch (error) {
      expect(error).toBeInstanceOf(InfluenceGateError);
      expect((error as InfluenceGateError).result).toMatchObject({ decision: "review", authority: "propose" });
    }
  });
});
