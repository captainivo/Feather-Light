import { rmSync } from "node:fs";
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
});
