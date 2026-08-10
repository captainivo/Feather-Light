import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CurrentSnapshot, HistoryFile, Snapshot } from "./types.js";

export const HISTORY_SCHEMA_VERSION = 1;
const HISTORY_MAX_SNAPSHOTS = 180;

export function loadHistory(dir: string): HistoryFile {
  const path = join(dir, "history.json");
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (
      data !== null &&
      typeof data === "object" &&
      Array.isArray((data as HistoryFile).snapshots)
    ) {
      return data as HistoryFile;
    }
  } catch {
    // fall through to a fresh history
  }
  return { schema_version: HISTORY_SCHEMA_VERSION, snapshots: [] };
}

function buildSnapshot(now: string, current: CurrentSnapshot | null): Snapshot {
  const emo = current?.emotional_state ?? {};
  const weather = current?.weather ?? {};
  return {
    ts: now,
    earth_date: current?.earth_date ?? null,
    absolute_day: current?.absolute_day ?? null,
    valence: emo.valence ?? null,
    arousal: emo.arousal ?? null,
    connection: emo.connection ?? null,
    energy: emo.energy ?? null,
    temperature_current_c: weather.temperature_current_c ?? null,
  };
}

/** Append a snapshot if it differs from the last one; cap the list. */
export function appendSnapshot(history: HistoryFile, now: string, current: CurrentSnapshot | null): boolean {
  const snap = buildSnapshot(now, current);
  const last = history.snapshots[history.snapshots.length - 1];
  if (
    last &&
    last.absolute_day === snap.absolute_day &&
    last.valence === snap.valence &&
    last.arousal === snap.arousal &&
    last.connection === snap.connection &&
    last.energy === snap.energy &&
    last.temperature_current_c === snap.temperature_current_c
  ) {
    return false;
  }
  history.snapshots.push(snap);
  if (history.snapshots.length > HISTORY_MAX_SNAPSHOTS) {
    history.snapshots = history.snapshots.slice(-HISTORY_MAX_SNAPSHOTS);
  }
  return true;
}

export function saveHistory(dir: string, history: HistoryFile): void {
  writeFileSync(join(dir, "history.json"), JSON.stringify(history, null, 2));
}

