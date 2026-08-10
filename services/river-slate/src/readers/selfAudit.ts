import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const signSchema = z.object({
  level: z.string(),
  note: z.string(),
});

const selfAuditSchema = z.object({
  as_of: z.string(),
  signs: z.record(z.string(), signSchema),
});

export type SelfAudit = z.infer<typeof selfAuditSchema>;

export function readSelfAudit(dir: string): SelfAudit {
  const raw = readFileSync(join(dir, "self_audit.json"), "utf8");
  return selfAuditSchema.parse(JSON.parse(raw));
}

