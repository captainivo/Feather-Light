import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const loopbackHosts = ["127.0.0.1", "localhost", "::1"];
const serviceHost = z.string().refine((value) => {
  if (loopbackHosts.includes(value)) return true;
  if (value === "0.0.0.0") return true;
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(value);
}, { message: "server host must be loopback, a private LAN address, or the container wildcard" });

const configSchema = z.object({
  server: z.object({
      host: serviceHost.default("127.0.0.1"),
      port: z.number().int().min(1).max(65_535).default(8765),
      authTokenFile: z.string().min(1).optional(),
    }).superRefine((server, context) => {
      if (!loopbackHosts.includes(server.host) && !server.authTokenFile) {
        context.addIssue({
          code: "custom",
          message: "authTokenFile is required when the server binds to a private LAN address",
          path: ["authTokenFile"],
        });
      }
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
  ollama: z
    .object({
      baseUrl: z
        .string()
        .url()
        .refine((value) => {
          const hostname = new URL(value).hostname;
          if (["127.0.0.1", "localhost", "::1"].includes(hostname)) return true;
          return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);
        }, {
          message: "Ollama service must be loopback-only or on a private LAN",
        })
        .default("http://127.0.0.1:11434"),
      model: z.string().min(1).default("qwen3:4b-instruct"),
      temperature: z.number().min(0).max(2).default(1.1),
      contextWindow: z.number().int().min(512).max(8_192).default(4_096),
      timeoutMs: z.number().int().min(1_000).max(120_000).default(60_000),
      archiveSample: z.number().int().min(1).max(8).default(3),
      conversationStorePath: z.string().min(1).optional(),
      conversationSessionKey: z.string().min(1).optional(),
      recentConversations: z.number().int().min(0).max(50).optional(),
      openHandSample: z.number().int().min(0).max(20).optional(),
    })
    .default({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:4b-instruct",
      temperature: 1.1,
      contextWindow: 4_096,
      timeoutMs: 60_000,
      archiveSample: 3,
    }),
  environment: z
    .object({
      timezone: z.string().min(1).default("America/Vancouver"),
      masterSeed: z.string().min(16).default("aauthora-canonical-seed-v1"),
      simulationStartDate: z.string().date().default("2026-07-16"),
      startingAbsoluteDay: z.number().int().min(1).default(1),
    })
    .default({
      timezone: "America/Vancouver",
      masterSeed: "aauthora-canonical-seed-v1",
      simulationStartDate: "2026-07-16",
      startingAbsoluteDay: 1,
    }),
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
  const configDirectory = dirname(absolutePath);
  const raw = parseYaml(readFileSync(absolutePath, "utf8")) as unknown;
  const config = configSchema.parse(raw);
  config.database.path = resolve(configDirectory, config.database.path);
  if (config.server.authTokenFile) config.server.authTokenFile = resolve(configDirectory, config.server.authTokenFile);
  for (const root of config.archiveRoots) root.path = resolve(configDirectory, root.path);
  return config;
}
