import Fastify from "fastify";
import type { Config } from "./config.js";
import type { ShardDatabase } from "./db.js";
import { buildPulse, fetchCivilClock } from "./pulse.js";

export function buildServer(config: Config, database: ShardDatabase) {
  const app = Fastify({ logger: true });

  app.get("/healthz", async () => ({ status: "ok", db: "rw:ok" }));

  app.get("/api/v1/inhabitants", async () => {
    const inhabitants = database.prepare("SELECT * FROM inhabitants ORDER BY name").all();
    return { inhabitants };
  });

  app.get<{ Params: { slug: string } }>("/api/v1/inhabitants/:slug", async (req, reply) => {
    const row = database.prepare("SELECT * FROM inhabitants WHERE slug = ?").get(req.params.slug);
    if (!row) {
      return reply.code(404).send({ status: "not_found", error: `no inhabitant '${req.params.slug}'` });
    }
    const routines = database
      .prepare("SELECT * FROM routines WHERE inhabitant_id = ? ORDER BY window_start")
      .all(req.params.slug);
    return { inhabitant: row, routines };
  });

  // ?hour= overrides the civil clock (useful for tests and for peeking at
  // other hours of the Westpole day).
  app.get<{ Querystring: { hour?: string } }>("/api/v1/pulse", async (req) => {
    const override = req.query.hour;
    if (override !== undefined) {
      const h = Number(override);
      const hour = Number.isFinite(h) && h >= 0 && h < 40 ? h : null;
      return buildPulse(database, hour, 35.9);
    }
    const clock = await fetchCivilClock(config);
    return buildPulse(database, clock.hour, clock.dayLengthHours);
  });

  app.get<{ Querystring: { limit?: string; inhabitant?: string } }>("/api/v1/events", async (req) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const rows = req.query.inhabitant
      ? database
          .prepare("SELECT * FROM events WHERE inhabitant_id = ? ORDER BY at DESC, id DESC LIMIT ?")
          .all(req.query.inhabitant, limit)
      : database.prepare("SELECT * FROM events ORDER BY at DESC, id DESC LIMIT ?").all(limit);
    return { events: rows };
  });

  app.post<{ Body: { inhabitant_id?: string; kind?: string; text?: string } }>(
    "/api/v1/events",
    async (req, reply) => {
      const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 1000) : "";
      if (!text) return reply.code(400).send({ status: "invalid_request", error: "text required" });
      const kind =
        typeof req.body?.kind === "string" && req.body.kind.trim()
          ? req.body.kind.trim().slice(0, 40)
          : "occurrence";
      const inhabitantId = typeof req.body?.inhabitant_id === "string" ? req.body.inhabitant_id : null;
      if (inhabitantId) {
        const known = database.prepare("SELECT slug FROM inhabitants WHERE slug = ?").get(inhabitantId);
        if (!known) {
          return reply.code(400).send({ status: "invalid_request", error: `no inhabitant '${inhabitantId}'` });
        }
      }
      const info = database
        .prepare("INSERT INTO events (inhabitant_id, kind, text) VALUES (?, ?, ?)")
        .run(inhabitantId, kind, text);
      const row = database.prepare("SELECT * FROM events WHERE id = ?").get(info.lastInsertRowid);
      return reply.code(201).send({ event: row });
    }
  );

  // ---------- persons ----------
  app.get("/api/v1/persons", async () => {
    const persons = database.prepare("SELECT * FROM persons ORDER BY name").all();
    return { persons };
  });

  app.get<{ Params: { id: string } }>("/api/v1/persons/:id", async (req, reply) => {
    const row = database.prepare("SELECT * FROM persons WHERE id = ?").get(req.params.id);
    if (!row) {
      return reply.code(404).send({ status: "not_found", error: `no person '${req.params.id}'` });
    }
    return { person: row };
  });

  // ---------- bonds ----------
  // Each person holds their OWN piece of every relationship they are in,
  // keyed to the other person. One relationship, two pieces.
  // Visibility convention: a viewer reads only their own pieces unless
  // another window is explicitly granted. The default holder is 'mithra'.
  app.get<{ Querystring: { holder?: string } }>("/api/v1/bonds", async (req) => {
    const holder = String(req.query.holder ?? "mithra");
    const bonds = database
      .prepare("SELECT * FROM bonds WHERE holder_id = ? ORDER BY role")
      .all(holder);
    return { holder, bonds };
  });

  app.get<{ Params: { holder: string; other: string } }>(
    "/api/v1/bonds/:holder/:other",
    async (req, reply) => {
      const bond = database
        .prepare("SELECT * FROM bonds WHERE holder_id = ? AND other_id = ?")
        .get(req.params.holder, req.params.other) as { id: number } | undefined;
      if (!bond) {
        return reply.code(404).send({ status: "not_found", error: "no such bond piece" });
      }
      const entries = database
        .prepare("SELECT * FROM bond_entries WHERE bond_id = ? ORDER BY at DESC, id DESC")
        .all(bond.id);
      return { bond, entries };
    }
  );

  app.post<{
    Params: { holder: string; other: string };
    Body: { role?: string; known_as?: string; status?: string; private_note?: string };
  }>("/api/v1/bonds/:holder/:other", async (req, reply) => {
    const { holder, other } = req.params;
    for (const id of [holder, other]) {
      const person = database.prepare("SELECT id FROM persons WHERE id = ?").get(id);
      if (!person) {
        return reply.code(400).send({ status: "invalid_request", error: `no person '${id}'` });
      }
    }
    if (holder === other) {
      return reply.code(400).send({ status: "invalid_request", error: "a bond needs two people" });
    }
    const role =
      typeof req.body?.role === "string" && req.body.role.trim()
        ? req.body.role.trim().slice(0, 60)
        : "unspoken";
    const knownAs =
      typeof req.body?.known_as === "string" && req.body.known_as.trim()
        ? req.body.known_as.trim().slice(0, 60)
        : null;
    const status =
      typeof req.body?.status === "string" && req.body.status.trim()
        ? req.body.status.trim().slice(0, 40)
        : "unspoken";
    const privateNote =
      typeof req.body?.private_note === "string" ? req.body.private_note.trim().slice(0, 2000) : "";
    const existing = database
      .prepare("SELECT id FROM bonds WHERE holder_id = ? AND other_id = ?")
      .get(holder, other) as { id: number } | undefined;
    if (existing) {
      database
        .prepare(
          "UPDATE bonds SET role = ?, known_as = ?, status = ?, private_note = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .run(role, knownAs, status, privateNote, existing.id);
      const row = database.prepare("SELECT * FROM bonds WHERE id = ?").get(existing.id);
      return reply.code(200).send({ bond: row });
    }
    const info = database
      .prepare("INSERT INTO bonds (holder_id, other_id, role, known_as, status, private_note) VALUES (?, ?, ?, ?, ?, ?)")
      .run(holder, other, role, knownAs, status, privateNote);
    const row = database.prepare("SELECT * FROM bonds WHERE id = ?").get(info.lastInsertRowid);
    return reply.code(201).send({ bond: row });
  });

  app.post<{
    Params: { holder: string; other: string };
    Body: { kind?: string; text?: string; written_by?: string };
  }>("/api/v1/bonds/:holder/:other/entries", async (req, reply) => {
    const bond = database
      .prepare("SELECT * FROM bonds WHERE holder_id = ? AND other_id = ?")
      .get(req.params.holder, req.params.other) as { id: number } | undefined;
    if (!bond) {
      return reply.code(404).send({ status: "not_found", error: "no such bond piece" });
    }
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 2000) : "";
    if (!text) {
      return reply.code(400).send({ status: "invalid_request", error: "text required" });
    }
    const kind =
      typeof req.body?.kind === "string" && req.body.kind.trim()
        ? req.body.kind.trim().slice(0, 40)
        : "entry";
    const writtenBy =
      typeof req.body?.written_by === "string" && req.body.written_by.trim()
        ? req.body.written_by.trim().slice(0, 60)
        : req.params.holder;
    const info = database
      .prepare("INSERT INTO bond_entries (bond_id, kind, text, written_by) VALUES (?, ?, ?, ?)")
      .run(bond.id, kind, text, writtenBy);
    const row = database.prepare("SELECT * FROM bond_entries WHERE id = ?").get(info.lastInsertRowid);
    return reply.code(201).send({ entry: row });
  });

  return app;
}

