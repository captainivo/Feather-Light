import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { buildContinuityManifest } from "../src/continuity.js";
import { migrate, openDatabase, type FeatherDatabase } from "../src/database.js";

const directories: string[] = [];
const databases: FeatherDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "feather-continuity-"));
  directories.push(directory);
  const archive = join(directory, "archive");
  mkdirSync(archive);
  const foundation = join(directory, "FOUNDATION.md");
  writeFileSync(foundation, "Permanent identity\n", { mode: 0o600 });
  const configPath = join(directory, "config.yaml");
  writeFileSync(configPath, `
server:
  host: "127.0.0.1"
database:
  path: "state.sqlite3"
continuity:
  identityArtifacts:
    - id: "foundation"
      path: "FOUNDATION.md"
      required: true
      immutable: true
archiveRoots:
  - rootId: "canonical"
    displayName: "Canonical"
    path: "archive"
    readOnly: true
    enabled: true
`);
  const config = loadConfig(configPath);
  const database = openDatabase(config.database.path);
  databases.push(database);
  migrate(database);
  database.prepare(`
    INSERT INTO archive_roots
      (root_id,display_name,absolute_path,read_only,enabled,last_complete_ingest_id,last_attempted_ingest_id)
    VALUES ('canonical','Canonical',?,1,1,'ingest-complete','ingest-complete')
  `).run(archive);
  const stateJson = JSON.stringify({ absolute_day: 4, weather: { sky: "clear" } });
  database.prepare(`
    INSERT INTO environment_days
      (absolute_day,earth_date,generated_at,generator_version,seed_fingerprint,source,state_json)
    VALUES (4,'2026-08-14','2026-08-14T12:00:00.000Z','test-1','seed-4','typescript',?)
  `).run(stateJson);
  return { database, config, foundation, directory };
}

describe("continuity manifest", () => {
  it("certifies identity, migrations, archive index, environment, and writable stores without content or paths", () => {
    const { database, config, foundation, directory } = fixture();
    const manifest = buildContinuityManifest(database, config, "2026-08-14T20:00:00.000Z");

    expect(manifest.health).toBe("ready");
    expect(manifest.readOnly).toBe(true);
    expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.components.identity).toMatchObject({
      status: "verified",
      artifacts: [{ id: "foundation", required: true, immutable: true, status: "verified" }],
    });
    expect(manifest.components.migrations).toMatchObject({ status: "verified", appliedVersion: 24, appliedCount: 24 });
    expect(manifest.components.archive).toMatchObject({ status: "verified", roots: [{ id: "canonical", status: "indexed" }] });
    expect(manifest.components.environment).toMatchObject({ status: "verified", current: { absoluteDay: 4 } });
    expect(manifest.components.writableStores).toMatchObject({ status: "verified" });

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("Permanent identity");
    expect(serialized).not.toContain(foundation);
    expect(serialized).not.toContain(directory);
  });

  it("keeps its certificate hash stable across generation times and changes it when an artifact changes", () => {
    const { database, config, foundation } = fixture();
    const first = buildContinuityManifest(database, config, "2026-08-14T20:00:00.000Z");
    const second = buildContinuityManifest(database, config, "2026-08-14T21:00:00.000Z");
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(second.generatedAt).not.toBe(first.generatedAt);

    writeFileSync(foundation, "Permanent identity, revised only for this synthetic test\n");
    const changed = buildContinuityManifest(database, config, "2026-08-14T22:00:00.000Z");
    expect(changed.manifestHash).not.toBe(first.manifestHash);
  });

  it("reports an unavailable required identity artifact as an error without throwing", () => {
    const { database, config, foundation } = fixture();
    rmSync(foundation);
    const manifest = buildContinuityManifest(database, config);
    expect(manifest.health).toBe("error");
    expect(manifest.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "required_identity_artifact_unavailable",
      component: "identity:foundation",
    }));
    expect(JSON.stringify(manifest)).not.toContain(foundation);
  });
});
