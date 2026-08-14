import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, SCHEMA_VERSION, type FeatherDatabase } from "../src/database.js";

const resources: FeatherDatabase[] = [];
const paths: string[] = [];
afterEach(() => {
  for (const database of resources.splice(0)) database.close();
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

describe("migration integrity", () => {
  it("records and verifies a checksum for every migration", () => {
    const path = join(process.env.TMPDIR ?? "/tmp", `feather-light-migrate-${crypto.randomUUID()}.sqlite3`);
    paths.push(path);
    const database = openDatabase(path);
    resources.push(database);
    migrate(database);
    const rows = database.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as Array<{ version: number; checksum: string }>;
    expect(rows).toHaveLength(SCHEMA_VERSION);
    expect(rows.every((row) => row.checksum.length === 64)).toBe(true);
    database.prepare("UPDATE schema_migrations SET checksum='incorrect' WHERE version=1").run();
    expect(() => migrate(database)).toThrow("checksum mismatch for version 1");
  });

  it("upgrades an existing version-22 database without losing influence receipts", () => {
    const path = join(process.env.TMPDIR ?? "/tmp", `feather-light-v22-${crypto.randomUUID()}.sqlite3`);
    paths.push(path);
    const database = openDatabase(path);
    resources.push(database);
    database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort().slice(0, 22);
    for (const [index, file] of files.entries()) {
      database.exec(readFileSync(join("migrations", file), "utf8"));
      database.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)")
        .run(index + 1, "2026-08-14T00:00:00.000Z");
    }
    database.prepare(`
      INSERT INTO influence_decisions
      (request_id,request_fingerprint,policy_id,policy_version,source_class,domain,operation,
       subject_ref,source_ref,authority,decision,evaluated_at)
      VALUES ('v22-review','fingerprint','v1:model_inference:inner_growth',1,'model_inference',
        'inner_growth','write','growth:new','model:test','propose','review','2026-08-14T00:00:00.000Z')
    `).run();

    migrate(database);

    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
    expect(database.prepare(
      "SELECT request_id,payload_hash,adopts_request_id FROM influence_decisions WHERE request_id='v22-review'",
    ).get()).toEqual({ request_id: "v22-review", payload_hash: null, adopts_request_id: null });
    expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 23 });
  });
});
