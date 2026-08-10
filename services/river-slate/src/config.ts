import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(8422),
  bind: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
  healthCardDir: z
    .string()
    .min(1)
    .default(join(homedir(), "aauthora-systems", "health-card")),
  featherLightDb: z
    .string()
    .min(1)
    .default(join(homedir(), ".hermes", "mithra", "feather-light", "state", "feather-light.sqlite3")),
  aauthoraApiBaseUrl: z
    .string()
    .url()
    .default("http://127.0.0.1:8421"),
  telemetryDb: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): Config {
  return configSchema.parse({
    port: env.RIVER_SLATE_PORT ? Number(env.RIVER_SLATE_PORT) : undefined,
    bind: env.RIVER_SLATE_BIND,
    healthCardDir: env.HEALTH_CARD_DIR,
    featherLightDb: env.FEATHER_LIGHT_DB,
    aauthoraApiBaseUrl: env.AUTHORA_API_BASE_URL,
    telemetryDb: env.TELEMETRY_DB,
  });
}

