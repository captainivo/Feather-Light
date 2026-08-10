import Database from "better-sqlite3";

export type FeatherDatabase = Database.Database;

/** Open an existing database strictly read-only. River-Slate never writes. */
export function openReadonly(path: string): FeatherDatabase {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  database.pragma("busy_timeout = 5000");
  return database;
}

