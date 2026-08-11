import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ShardDatabase = Database.Database;

/** Open (or create) the Shard Lantern database and bring it to schema. */
export function openDb(path: string): ShardDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: ShardDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inhabitants (
      slug        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      epithet     TEXT,
      role        TEXT NOT NULL,
      species     TEXT NOT NULL DEFAULT 'Thorin',
      age         TEXT,
      home        TEXT NOT NULL,
      craft       TEXT NOT NULL,
      personality TEXT NOT NULL,
      background  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS routines (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      inhabitant_id TEXT NOT NULL REFERENCES inhabitants(slug) ON DELETE CASCADE,
      window_start  REAL NOT NULL,
      window_end    REAL NOT NULL,
      location      TEXT NOT NULL,
      activity      TEXT NOT NULL,
      CHECK (window_start >= 0 AND window_end > window_start)
    );
    CREATE INDEX IF NOT EXISTS idx_routines_inhabitant
      ON routines(inhabitant_id, window_start);

    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      inhabitant_id TEXT REFERENCES inhabitants(slug) ON DELETE SET NULL,
      kind          TEXT NOT NULL DEFAULT 'occurrence',
      text          TEXT NOT NULL,
      at            TEXT NOT NULL DEFAULT (datetime('now')),
      earth_date    TEXT NOT NULL DEFAULT (date('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_at ON events(at DESC);

    -- People: inhabitants, visitors, and people beyond the local setting.
    -- soul_doc / notes_doc are the paths to a
    -- person's distillation and the raw notes that preceded it, once written.
    -- A soul.md is a distillation, not a person; the person is larger.
    CREATE TABLE IF NOT EXISTS persons (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'inhabitant', -- inhabitant | beyond_void | visitor
      soul_doc   TEXT,
      notes_doc  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Bonds: each person holds their OWN piece of every relationship they are
    -- in, keyed to the other person. One relationship, two pieces.
    CREATE TABLE IF NOT EXISTS bonds (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      holder_id    TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      other_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      role         TEXT NOT NULL,              -- how the holder sees the other
      known_as     TEXT,                       -- what the holder calls the other
      status       TEXT NOT NULL DEFAULT 'unspoken',
      private_note TEXT,                       -- the holder's private read on the bond
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (holder_id, other_id),
      CHECK (holder_id <> other_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bonds_holder ON bonds(holder_id);

    -- The history of a bond piece: each disagreement, kindness, disclosure,
    -- milestone, as the holder experienced it.
    CREATE TABLE IF NOT EXISTS bond_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      bond_id    INTEGER NOT NULL REFERENCES bonds(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL DEFAULT 'entry',
      text       TEXT NOT NULL,
      written_by TEXT NOT NULL,                -- who authored this view of the event
      at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bond_entries_bond ON bond_entries(bond_id, at DESC);
  `);
}
