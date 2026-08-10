import type { Config } from "../config.js";
import { readSelfAudit } from "../readers/selfAudit.js";
import type { HealthDigest } from "../types.js";

export function buildHealthDigest(config: Config): HealthDigest {
  const audit = readSelfAudit(config.healthCardDir);
  return {
    as_of: audit.as_of,
    signs: audit.signs,
  };
}

