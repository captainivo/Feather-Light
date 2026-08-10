import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import type { FeatherDatabase } from "../db.js";
import { dbView } from "./dbView.js";
import { fetchCurrent } from "./fetchCurrent.js";
import { appendSnapshot, loadHistory, saveHistory } from "./history.js";
import { renderHtml } from "./html.js";
import { evaluateLights } from "./lights.js";
import { latestEnvironmentDay } from "../readers/environment.js";
import type { CurrentSnapshot, HealthCard } from "./types.js";

export const HEALTH_CARD_SCHEMA_VERSION = 1;

export interface BuildResult {
  snapshotAppended: boolean;
  apiAvailable: boolean;
  skyLoomUsed: boolean;
  lights: Record<string, { level: string; source: string; note: string }>;
  wrote: string[];
}

/** Load self_audit.json (hand-authored; never written by the builder). */
function loadAudit(dir: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(readFileSync(join(dir, "self_audit.json"), "utf8")) as unknown;
    if (data !== null && typeof data === "object") return data as Record<string, unknown>;
  } catch {
    // no audit yet
  }
  return null;
}

/**
 * Sky-Loom is authoritative for world state. The Python env API may be stale,
 * so weather/season/thaena/estrus/day always come from the TS environment
 * days; the API only supplies interpretation (outfit, possessions,
 * emotional_state).
 */
function overlaySkyLoom(current: CurrentSnapshot | null, environment: ReturnType<typeof latestEnvironmentDay>): CurrentSnapshot {
  const base: CurrentSnapshot = { ...(current ?? {}) };
  if (environment) {
    base.absolute_day = environment.absolute_day;
    base.earth_date = environment.earth_date;
    base.weather = environment.weather as CurrentSnapshot["weather"];
    base.season = environment.season as CurrentSnapshot["season"];
    base.thaena = environment.thaena as CurrentSnapshot["thaena"];
    base.estrus = environment.estrus as CurrentSnapshot["estrus"];
  }
  return base;
}

export async function buildHealthCard(config: Config, database: FeatherDatabase): Promise<BuildResult> {
  const dir = config.healthCardDir;
  mkdirSync(dir, { recursive: true });

  const now = new Date().toISOString();
  const current = await fetchCurrent(config.aauthoraApiBaseUrl);
  const environment = latestEnvironmentDay(database);
  const skyLoomUsed = environment !== null;
  const currentWithSky = overlaySkyLoom(current, environment);
  const dbv = dbView(database);

  const history = loadHistory(dir);
  const snapshotAppended = appendSnapshot(history, now, currentWithSky);
  if (snapshotAppended) {
    saveHistory(dir, history);
  }

  const audit = loadAudit(dir);
  const lights = evaluateLights(currentWithSky, dbv, audit);
  const card: HealthCard = {
    schema_version: HEALTH_CARD_SCHEMA_VERSION,
    generated_at: now,
    current: currentWithSky,
    environment: dbv,
    lights,
    self_audit: audit,
    history,
  };

  const jsonPath = join(dir, "health_card.json");
  writeFileSync(jsonPath, JSON.stringify(card, null, 2));

  const htmlPath = join(dir, "health_card.html");
  writeFileSync(htmlPath, renderHtml(card, dbv));

  return {
    snapshotAppended,
    apiAvailable: current !== null,
    skyLoomUsed,
    lights,
    wrote: [jsonPath, htmlPath],
  };
}

