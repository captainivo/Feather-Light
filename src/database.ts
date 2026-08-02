import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

export const SCHEMA_VERSION = 3;

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
  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version),
  );
  for (const filename of readdirSync(migrationsPath).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    const version = Number.parseInt(filename.split("_")[0]!, 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsPath, filename), "utf8");
    database.transaction(() => {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    })();
  }
}
