import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ShardDatabase } from "./db.js";

const inhabitant = z.object({
  slug: z.string().min(1), name: z.string().min(1), epithet: z.string().nullable().default(null),
  role: z.string().min(1), species: z.string().min(1).default("unknown"), age: z.string().nullable().default(null),
  home: z.string().min(1), craft: z.string().min(1), personality: z.string().min(1), background: z.string().min(1),
}).strict();
const routine = z.object({
  inhabitant_id: z.string().min(1), window_start: z.number().nonnegative(), window_end: z.number().positive(),
  location: z.string().min(1), activity: z.string().min(1),
}).strict().refine((value) => value.window_end > value.window_start, { message: "routine window must advance" });
const person = z.object({
  id: z.string().min(1), name: z.string().min(1), kind: z.string().min(1).default("inhabitant"),
  soul_doc: z.string().nullable().default(null), notes_doc: z.string().nullable().default(null),
}).strict();
const bond = z.object({
  holder_id: z.string().min(1), other_id: z.string().min(1), role: z.string().min(1),
  known_as: z.string().nullable().default(null), status: z.string().min(1).default("unspoken"),
  private_note: z.string().nullable().default(null),
}).strict().refine((value) => value.holder_id !== value.other_id, { message: "a person cannot bond to itself" });
const bondEntry = z.object({
  holder_id: z.string().min(1), other_id: z.string().min(1), kind: z.string().min(1).default("entry"),
  text: z.string().min(1), written_by: z.string().min(1),
}).strict();
const event = z.object({
  inhabitant_id: z.string().min(1).nullable().default(null), kind: z.string().min(1).default("occurrence"),
  text: z.string().min(1),
}).strict();

export const shardSeedSchema = z.object({
  inhabitants: z.array(inhabitant).default([]), routines: z.array(routine).default([]),
  persons: z.array(person).default([]), bonds: z.array(bond).default([]),
  bond_entries: z.array(bondEntry).default([]), events: z.array(event).default([]),
}).strict();

export function seedShardDatabase(database: ShardDatabase, value: unknown): boolean {
  const seed = shardSeedSchema.parse(value);
  const populated = database.prepare(`
    SELECT (SELECT count(*) FROM inhabitants) + (SELECT count(*) FROM persons) AS count
  `).get() as { count: number };
  if (populated.count > 0) return false;
  database.transaction(() => {
    const insertInhabitant = database.prepare(`INSERT INTO inhabitants
      (slug,name,epithet,role,species,age,home,craft,personality,background)
      VALUES (@slug,@name,@epithet,@role,@species,@age,@home,@craft,@personality,@background)`);
    const insertRoutine = database.prepare(`INSERT INTO routines
      (inhabitant_id,window_start,window_end,location,activity)
      VALUES (@inhabitant_id,@window_start,@window_end,@location,@activity)`);
    const insertPerson = database.prepare(`INSERT INTO persons
      (id,name,kind,soul_doc,notes_doc) VALUES (@id,@name,@kind,@soul_doc,@notes_doc)`);
    const insertBond = database.prepare(`INSERT INTO bonds
      (holder_id,other_id,role,known_as,status,private_note)
      VALUES (@holder_id,@other_id,@role,@known_as,@status,@private_note)`);
    const findBond = database.prepare("SELECT id FROM bonds WHERE holder_id=? AND other_id=?");
    const insertEntry = database.prepare(`INSERT INTO bond_entries
      (bond_id,kind,text,written_by) VALUES (?,?,?,?)`);
    const insertEvent = database.prepare(`INSERT INTO events
      (inhabitant_id,kind,text) VALUES (@inhabitant_id,@kind,@text)`);
    for (const row of seed.inhabitants) insertInhabitant.run(row);
    for (const row of seed.routines) insertRoutine.run(row);
    for (const row of seed.persons) insertPerson.run(row);
    for (const row of seed.bonds) insertBond.run(row);
    for (const row of seed.bond_entries) {
      const match = findBond.get(row.holder_id, row.other_id) as { id: number } | undefined;
      if (!match) throw new Error(`seed bond entry has no bond: ${row.holder_id}/${row.other_id}`);
      insertEntry.run(match.id, row.kind, row.text, row.written_by);
    }
    for (const row of seed.events) insertEvent.run(row);
  })();
  return true;
}

export function seedShardDatabaseFromFile(database: ShardDatabase, path: string): boolean {
  return seedShardDatabase(database, JSON.parse(readFileSync(path, "utf8")) as unknown);
}
