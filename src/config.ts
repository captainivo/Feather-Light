import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const localHost = z.enum(["127.0.0.1", "localhost", "::1"]);

const configSchema = z.object({
  server: z
    .object({
      host: localHost.default("127.0.0.1"),
      port: z.number().int().min(1).max(65_535).default(8765),
    })
    .default({ host: "127.0.0.1", port: 8765 }),
  database: z.object({ path: z.string().min(1).default("state/feather-light.sqlite3") }),
  aauthora: z
    .object({
      baseUrl: z
        .string()
        .url()
        .refine((value) => ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname), {
          message: "Aauthora service must be loopback-only",
        })
        .default("http://127.0.0.1:8421"),
      timeoutMs: z.number().int().min(100).max(10_000).default(2_000),
    })
    .default({ baseUrl: "http://127.0.0.1:8421", timeoutMs: 2_000 }),
  archiveRoots: z.array(
    z.object({
      rootId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      displayName: z.string().min(1),
      path: z.string().min(1),
      readOnly: z.literal(true),
      enabled: z.boolean().default(true),
    }),
  ),
  limits: z
    .object({
      maxFileBytes: z.number().int().min(1).max(10_000_000).default(1_048_576),
      searchResults: z.number().int().min(1).max(100).default(10),
      excerptCharacters: z.number().int().min(100).max(8_000).default(1_200),
      responseCharacters: z.number().int().min(1_000).max(64_000).default(16_000),
    })
    .default({
      maxFileBytes: 1_048_576,
      searchResults: 10,
      excerptCharacters: 1_200,
      responseCharacters: 16_000,
    }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(path = process.env.FEATHER_LIGHT_CONFIG ?? "config.yaml"): Config {
  const absolutePath = resolve(path);
  const raw = parseYaml(readFileSync(absolutePath, "utf8")) as unknown;
  const config = configSchema.parse(raw);
  config.database.path = resolve(config.database.path);
  for (const root of config.archiveRoots) root.path = resolve(root.path);
  return config;
}
