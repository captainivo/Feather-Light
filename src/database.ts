import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export const SCHEMA_VERSION = 20;

export type FeatherDatabase = Database.Database;

export function openDatabase(path: string): FeatherDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return database;
}

export function migrate(database: FeatherDatabase, migrationsPath = "migrations"): void {
  database.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const migrations = new Map<number, { sql: string; checksum: string }>();
  for (const filename of readdirSync(migrationsPath).filter((name) => name.endsWith(".sql")).sort()) {
    const match = filename.match(/^(\d{3})_[a-z0-9_-]+\.sql$/i);
    if (!match) throw new Error(`invalid migration filename: ${filename}`);
    const version = Number.parseInt(match[1]!, 10);
    if (migrations.has(version)) throw new Error(`duplicate migration version ${version}`);
    const sql = readFileSync(join(migrationsPath, filename), "utf8");
    migrations.set(version, { sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  for (let version = 1; version <= SCHEMA_VERSION; version += 1) {
    if (!migrations.has(version)) throw new Error(`missing migration version ${version}`);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const appliedRows = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
    const applied = new Set(appliedRows.map((row) => row.version));
    const future = appliedRows.find((row) => row.version > SCHEMA_VERSION);
    if (future) throw new Error(`database schema version ${future.version} is newer than supported version ${SCHEMA_VERSION}`);
    let hasChecksums = (database.prepare("PRAGMA table_info(schema_migrations)").all() as Array<{ name: string }>)
      .some((column) => column.name === "checksum");
    if (hasChecksums) {
      const rows = database.prepare("SELECT version, checksum FROM schema_migrations WHERE checksum IS NOT NULL").all() as Array<{ version: number; checksum: string }>;
      for (const row of rows) {
        const migration = migrations.get(row.version);
        if (migration && row.checksum !== migration.checksum) throw new Error(`migration checksum mismatch for version ${row.version}`);
      }
    }
    for (let version = 1; version <= SCHEMA_VERSION; version += 1) {
      if (applied.has(version)) continue;
      const migration = migrations.get(version)!;
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    }
    hasChecksums = (database.prepare("PRAGMA table_info(schema_migrations)").all() as Array<{ name: string }>)
      .some((column) => column.name === "checksum");
    if (hasChecksums) {
      const update = database.prepare("UPDATE schema_migrations SET checksum=? WHERE version=?");
      for (const [version, migration] of migrations) update.run(migration.checksum, version);
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.inTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
