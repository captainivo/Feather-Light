import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(8423),
  bind: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
  dbPath: z
    .string()
    .min(1)
    .default(join(homedir(), ".hermes", "mithra", "shard-lantern", "state", "shard-lantern.sqlite3")),
  retrievalApiUrl: z.string().url().default("http://127.0.0.1:8765"),
  seedFile: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): Config {
  return configSchema.parse({
    port: env.SHARD_LANTERN_PORT ? Number(env.SHARD_LANTERN_PORT) : undefined,
    bind: env.SHARD_LANTERN_BIND,
    dbPath: env.SHARD_LANTERN_DB,
    retrievalApiUrl: env.GRANITE_WING_URL,
    seedFile: env.SHARD_LANTERN_SEED_FILE,
  });
}
