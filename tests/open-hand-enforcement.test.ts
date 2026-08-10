import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { operateAgency } from "../src/agency.js";
import { capabilityPaths, evaluateAgencyEnforcement } from "../src/open-hand/enforcement.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";

const resources: FeatherDatabase[] = [];
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const database of resources.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function database(): FeatherDatabase {
  const value = openDatabase(":memory:");
  migrate(value);
  resources.push(value);
  return value;
}

function directive(db: FeatherDatabase, overrides: Partial<Parameters<typeof operateAgency>[1]> = {}) {
  return operateAgency(db, {
    action: "set",
    kind: "refusal",
    scope_type: "tool_action",
    scope_value: "tool:terminal",
    source_type: "verification",
    source_id: "enforcement-test",
    ...overrides,
  } as Parameters<typeof operateAgency>[1]);
}

describe("Open Hand action enforcement", () => {
  it("builds bounded deterministic capability paths", () => {
    expect(capabilityPaths({
      tool_name: "computer_use",
      args: { action: "click", recipient: "home", path: "/tmp/example", ignored: "not projected by adapter" },
    })).toEqual(expect.arrayContaining([
      "tool:computer_use",
      "tool:computer_use/action:click",
      "contact:home",
      "resource:/tmp/example",
      "field:action=click",
    ]));
  });

  it("blocks an exact tool but always leaves agency control reversible", () => {
    const db = database();
    directive(db);
    expect(evaluateAgencyEnforcement(db, { tool_name: "terminal", args: {} })).toMatchObject({
      blocked: true,
      matched_path: "tool:terminal",
    });
    expect(evaluateAgencyEnforcement(db, { tool_name: "read_file", args: {} })).toMatchObject({ blocked: false });
    expect(evaluateAgencyEnforcement(db, { tool_name: "mithra_agency", args: {} })).toMatchObject({
      blocked: false,
      exempt: true,
    });
  });

  it("supports exact actions without blocking sibling actions", () => {
    const db = database();
    directive(db, { scope_value: "tool:computer_use/action:click" });
    expect(evaluateAgencyEnforcement(db, { tool_name: "computer_use", args: { action: "click" } }))
      .toMatchObject({ blocked: true });
    expect(evaluateAgencyEnforcement(db, { tool_name: "computer_use", args: { action: "capture" } }))
      .toMatchObject({ blocked: false });
  });

  it("matches contact selectors and resource subtrees across equivalent tools", () => {
    const contactDb = database();
    directive(contactDb, { scope_type: "contact", scope_value: "contact:destination-A" });
    expect(evaluateAgencyEnforcement(contactDb, { tool_name: "send_message", args: { recipient: "destination-A" } }))
      .toMatchObject({ blocked: true, matched_path: "contact:destination-A" });
    expect(evaluateAgencyEnforcement(contactDb, { tool_name: "send_message", args: { recipient: "destination-B" } }))
      .toMatchObject({ blocked: false });

    const resourceDb = database();
    directive(resourceDb, { scope_type: "resource", scope_value: "resource:/private/notes/**" });
    expect(evaluateAgencyEnforcement(resourceDb, { tool_name: "read_file", args: { path: "/private/notes/a.md" } }))
      .toMatchObject({ blocked: true });
    expect(evaluateAgencyEnforcement(resourceDb, { tool_name: "write_file", args: { path: "/private/notes/a.md" } }))
      .toMatchObject({ blocked: true });
    expect(evaluateAgencyEnforcement(resourceDb, { tool_name: "read_file", args: { path: "/private/public/../notes/a.md" } }))
      .toMatchObject({ blocked: true });
    expect(evaluateAgencyEnforcement(resourceDb, { tool_name: "read_file", args: { path: "/private/notes-other/a.md" } }))
      .toMatchObject({ blocked: false });
  });

  it("does not turn corrections or permissions into blocks", () => {
    const correctionDb = database();
    directive(correctionDb, { kind: "correction", scope_type: "disclosure", scope_value: "tool:send_message" });
    expect(evaluateAgencyEnforcement(correctionDb, { tool_name: "send_message", args: {} }))
      .toMatchObject({ blocked: false });

    const permissionDb = database();
    directive(permissionDb, { kind: "explicit_permission", scope_value: "tool:terminal" });
    expect(evaluateAgencyEnforcement(permissionDb, { tool_name: "terminal", args: {} }))
      .toMatchObject({ blocked: false });
  });

  it("cannot bypass a resource boundary through an existing symbolic link", () => {
    const base = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "feather-light-symlink-"));
    temporaryDirectories.push(base);
    const protectedDirectory = join(base, "protected");
    const alias = join(base, "alias");
    mkdirSync(protectedDirectory);
    writeFileSync(join(protectedDirectory, "note.md"), "private");
    symlinkSync(protectedDirectory, alias, "dir");
    const db = database();
    directive(db, { scope_type: "resource", scope_value: `${protectedDirectory}/**` });
    expect(evaluateAgencyEnforcement(db, { tool_name: "read_file", args: { path: join(alias, "note.md") } }))
      .toMatchObject({ blocked: true });
  });

  it("stops blocking immediately after explicit retraction", () => {
    const db = database();
    const created = directive(db) as { directive_id: string };
    expect(evaluateAgencyEnforcement(db, { tool_name: "terminal", args: {} })).toMatchObject({ blocked: true });
    operateAgency(db, { action: "retract", directive_id: created.directive_id });
    expect(evaluateAgencyEnforcement(db, { tool_name: "terminal", args: {} })).toMatchObject({ blocked: false });
  });
});
