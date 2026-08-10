import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type { FeatherDatabase } from "./database.js";

type JsonObject = Record<string, unknown>;
export interface EnvironmentState extends JsonObject {
  absolute_day: number;
  earth_date: string;
  generated_at: string;
  thaena: JsonObject;
  season: JsonObject;
  weather: JsonObject;
  estrus: JsonObject;
}

export interface AauthoranClock extends JsonObject {
  timezone: string;
  mapping: "proportional_earth_civil_day";
  total_day_length_hours: number;
  hours_elapsed: number;
  hours_remaining: number;
  progress: number;
  time: string;
  light_state: "light" | "dark";
  daylight_start_hour: number;
  daylight_end_hour: number;
}

const DIRECTIONS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const SKIES = ["clear", "partly_cloudy", "mostly_cloudy", "overcast", "storm_clouds"];
const PATTERNS: Record<string, { min: number; typical: number; max: number; next: string[] }> = {
  clear_stable: { min: 2, typical: 4, max: 8, next: ["cloudy_calm", "warming", "cooling"] },
  cloudy_calm: { min: 1, typical: 3, max: 6, next: ["clear_stable", "wet_period", "snow_period", "storm_building", "fog_period"] },
  warming: { min: 2, typical: 4, max: 7, next: ["clear_stable", "cloudy_calm", "wet_period"] },
  cooling: { min: 2, typical: 4, max: 7, next: ["cloudy_calm", "snow_period", "storm_building"] },
  wet_period: { min: 2, typical: 4, max: 8, next: ["cloudy_calm", "storm_building", "fog_period"] },
  snow_period: { min: 2, typical: 4, max: 9, next: ["cloudy_calm", "storm_building", "cooling"] },
  fog_period: { min: 1, typical: 2, max: 5, next: ["cloudy_calm", "clear_stable"] },
  storm_building: { min: 1, typical: 2, max: 3, next: ["active_storm"] },
  active_storm: { min: 1, typical: 2, max: 4, next: ["storm_weakening"] },
  storm_weakening: { min: 1, typical: 2, max: 3, next: ["cloudy_calm", "fog_period"] },
};

class SeededRandom {
  private state: bigint;
  constructor(seed: string) {
    const digest = createHash("sha256").update(seed).digest("hex");
    this.state = BigInt(`0x${digest.slice(0, 16)}`) || 1n;
  }
  next(): number {
    let value = this.state;
    value ^= value << 13n;
    value ^= value >> 7n;
    value ^= value << 17n;
    this.state = BigInt.asUintN(64, value);
    return Number(this.state >> 11n) / 9_007_199_254_740_992;
  }
  uniform(low: number, high: number): number { return low + (high - low) * this.next(); }
  integer(low: number, high: number): number { return Math.floor(this.uniform(low, high + 1)); }
  choice<T>(values: T[]): T { return values[Math.min(values.length - 1, Math.floor(this.next() * values.length))]!; }
}

function rng(config: Config, day: number, namespace: string): SeededRandom {
  return new SeededRandom(`${config.environment.masterSeed}:${day}:${namespace}`);
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export function latestEnvironment(database: FeatherDatabase): EnvironmentState | null {
  const row = database.prepare("SELECT state_json FROM environment_days ORDER BY absolute_day DESC LIMIT 1").get() as
    | { state_json: string }
    | undefined;
  return row ? JSON.parse(row.state_json) as EnvironmentState : null;
}

function recentEnvironments(database: FeatherDatabase, limit = 32): EnvironmentState[] {
  const rows = database.prepare(
    "SELECT state_json FROM environment_days ORDER BY absolute_day DESC LIMIT ?",
  ).all(limit) as Array<{ state_json: string }>;
  return rows.reverse().map((row) => JSON.parse(row.state_json) as EnvironmentState);
}

export function importLegacyEnvironment(database: FeatherDatabase, value: JsonObject): EnvironmentState {
  const state: EnvironmentState = {
    absolute_day: Number(value.absolute_day),
    earth_date: String(value.earth_date),
    generated_at: typeof value.generated_at === "string" ? value.generated_at : new Date().toISOString(),
    thaena: object(value.thaena),
    season: object(value.season),
    weather: object(value.weather),
    estrus: object(value.estrus),
  };
  const parsedDate = new Date(`${state.earth_date}T00:00:00Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(state.earth_date)
    && !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === state.earth_date;
  if (!Number.isInteger(state.absolute_day) || state.absolute_day < 1 || !validDate) {
    throw new Error("legacy environment snapshot is missing its day identity");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);
  database.prepare(`
    INSERT INTO environment_days
      (absolute_day,earth_date,generated_at,generator_version,seed_fingerprint,source,state_json)
    VALUES (?,?,?,?,?,'legacy_import',?)
    ON CONFLICT(absolute_day) DO NOTHING
  `).run(state.absolute_day, state.earth_date, state.generated_at, "legacy-python-1.0.0", fingerprint, JSON.stringify(state));
  return latestEnvironment(database) ?? state;
}

export function localDate(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/**
 * Maps one Vancouver civil date proportionally onto one variable-length Aauthoran day.
 * Daylight is centered on the midpoint of that Aauthoran day; the daily environment
 * record remains generated once per Earth date.
 */
export function aauthoranClock(config: Config, state: EnvironmentState, now = new Date()): AauthoranClock {
  const weather = object(state.weather);
  const total = Number(weather.total_day_length_hours);
  const daylight = Number(weather.daylight_hours);
  if (!Number.isFinite(total) || total < 24 || total > 45 || !Number.isFinite(daylight) || daylight < 0 || daylight > total) {
    throw new Error("environment snapshot has invalid Aauthoran light-cycle values");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.environment.timezone,
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const earthSeconds = Number(values.hour) * 3_600 + Number(values.minute) * 60 + Number(values.second)
    + now.getMilliseconds() / 1_000;
  const progress = earthSeconds / 86_400;
  const elapsed = progress * total;
  const daylightStart = (total - daylight) / 2;
  const daylightEnd = daylightStart + daylight;
  const hour = Math.floor(elapsed);
  const minute = Math.floor((elapsed - hour) * 60);
  return {
    timezone: config.environment.timezone,
    mapping: "proportional_earth_civil_day",
    total_day_length_hours: round(total, 1),
    hours_elapsed: round(elapsed, 2),
    hours_remaining: round(total - elapsed, 2),
    progress: round(progress, 4),
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    light_state: elapsed >= daylightStart && elapsed < daylightEnd ? "light" : "dark",
    daylight_start_hour: round(daylightStart, 2),
    daylight_end_hour: round(daylightEnd, 2),
  };
}

function catchUpEnvironmentUnlocked(database: FeatherDatabase, config: Config, through: string) {
  const initial = latestEnvironment(database);
  if (!initial) throw new Error("environment has not been initialized from the legacy snapshot");
  if (initial.earth_date >= through) return [];
  const started = new Date().toISOString();
  const run = database.prepare(
    "INSERT INTO environment_generation_runs(trigger_type,started_at) VALUES ('catch-up',?)",
  ).run(started);
  const generated: EnvironmentState[] = [];
  try {
    let previous = initial;
    let next = addDay(previous.earth_date);
    while (next <= through) {
      previous = generateEnvironment(config, previous, recentEnvironments(database), next);
      persistEnvironment(database, previous);
      generated.push(previous);
      next = addDay(next);
    }
    database.prepare(`
      UPDATE environment_generation_runs SET ended_at=?,dates_processed_json=?,days_generated=?,success=1 WHERE id=?
    `).run(new Date().toISOString(), JSON.stringify(generated.map((item) => item.earth_date)), generated.length, run.lastInsertRowid);
    return generated;
  } catch (error) {
    database.prepare(`
      UPDATE environment_generation_runs SET ended_at=?,dates_processed_json=?,days_generated=?,success=0,error_details=? WHERE id=?
    `).run(new Date().toISOString(), JSON.stringify(generated.map((item) => item.earth_date)), generated.length,
      error instanceof Error ? error.message : String(error), run.lastInsertRowid);
    throw error;
  }
}

/** Keep the read-generate-insert sequence atomic for simultaneous catch-up callers. */
export function catchUpEnvironment(database: FeatherDatabase, config: Config, through = localDate(config.environment.timezone)) {
  return database.transaction(() => catchUpEnvironmentUnlocked(database, config, through))();
}

function persistEnvironment(database: FeatherDatabase, state: EnvironmentState): void {
  const fingerprint = createHash("sha256")
    .update(`${state.absolute_day}:${JSON.stringify(state.weather)}`)
    .digest("hex").slice(0, 16);
  database.prepare(`
    INSERT INTO environment_days
      (absolute_day,earth_date,generated_at,generator_version,seed_fingerprint,source,state_json)
    VALUES (?,?,?,?,?,'typescript',?)
  `).run(state.absolute_day, state.earth_date, state.generated_at, "feather-light-0.4.0", fingerprint, JSON.stringify(state));
}

function generateEnvironment(config: Config, previous: EnvironmentState, recent: EnvironmentState[], earthDate: string): EnvironmentState {
  const absoluteDay = previous.absolute_day + 1;
  const thaena = generateThaena(config, absoluteDay, earthDate, object(previous.thaena));
  const season = generateSeason(config, absoluteDay, object(previous.season), thaena);
  const weather = generateWeather(config, absoluteDay, object(previous.weather), season, Boolean(thaena.visible));
  const estrus = generateEstrus(config, absoluteDay, recent, season);
  return { absolute_day: absoluteDay, earth_date: earthDate, generated_at: new Date().toISOString(), thaena, season, weather, estrus };
}

function generateThaena(config: Config, day: number, earthDate: string, previous: JsonObject): JsonObject {
  const random = rng(config, day, "thaena");
  const date = new Date(`${earthDate}T00:00:00Z`);
  const ordinal = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  const yearly = rng(config, date.getUTCFullYear(), "thaena-year");
  const count = yearly.integer(1, 3);
  const last = isLeap(date.getUTCFullYear()) ? 366 : 365;
  const segment = last / count;
  let activeDirection: string | null = null;
  let activeStart = 0;
  for (let index = 0; index < count; index += 1) {
    const low = Math.max(1, Math.floor(index * segment) + 1);
    const high = Math.min(last, Math.floor((index + 1) * segment) - 7);
    const start = yearly.integer(low, Math.max(low, high));
    const duration = yearly.integer(2, 7);
    const direction = DIRECTIONS[yearly.integer(0, DIRECTIONS.length - 1)]!;
    if (ordinal >= start && ordinal <= Math.min(last, start + duration - 1)) {
      activeStart = start;
      activeDirection = direction;
      break;
    }
  }
  if (!activeDirection) return { visible: false, direction: null };
  let direction = activeDirection;
  if (ordinal !== activeStart && previous.visible && typeof previous.direction === "string") {
    const prior = DIRECTIONS.indexOf(previous.direction);
    if (prior >= 0) direction = DIRECTIONS[(prior + (random.next() < 0.22 ? random.choice([-1, 1]) : 0) + 8) % 8]!;
  }
  return { visible: true, direction };
}

function generateSeason(config: Config, day: number, previous: JsonObject, thaena: JsonObject): JsonObject {
  const random = rng(config, day, "season");
  const cycleDay = ((day - 1) % 600) + 1;
  let name = String(previous.name ?? (cycleDay >= 131 && cycleDay <= 400 ? "light" : "dark"));
  let days = Number(previous.days_in_current_season ?? 0) + 1;
  let active = Boolean(previous.transition_active);
  let strength = Number(previous.transition_strength ?? 0);
  let duration = Number(previous.transition_duration ?? 0);
  if (active) {
    strength = Math.min(1, strength + 1 / (duration || 12));
    if (strength >= 1) { name = name === "dark" ? "light" : "dark"; days = 1; active = false; strength = 0; duration = 0; }
  } else {
    const window = name === "dark" ? [81, 130] : [401, 470];
    let probability = transitionProbability(cycleDay, window, 0.015);
    if (thaena.visible) probability *= 1.25;
    if (random.next() < probability) { active = true; strength = 0.05; duration = random.integer(8, 20); }
  }
  const phase = seasonPhase(name, cycleDay, active);
  return {
    name, phase, days_in_current_season: days, cycle_day: cycleDay,
    transition_active: active, transition_strength: round(strength, 3),
    ...(active ? { transition_duration: duration } : {}),
  };
}

function generateWeather(config: Config, day: number, previous: JsonObject, season: JsonObject, thaena: boolean): JsonObject {
  const random = rng(config, day, "weather");
  const patternInfo = weatherPattern(random, previous, season, thaena);
  const [low, high] = temperature(random, previous, season, patternInfo.pattern, thaena);
  const [total, daylight, darkness] = light(random, previous, season);
  const sky = skyCondition(previous, patternInfo.pattern);
  const [wind, gust, direction] = windState(random, previous, patternInfo.pattern, thaena);
  const [precipitationType, intensity, amount] = precipitation(random, patternInfo.pattern, sky, low, high);
  const fog = fogState(random, patternInfo.pattern, wind, precipitationType, low);
  const [snowDepth, newSnow, snowLoss, ice, newIce, iceLoss] = accumulation(random, previous, precipitationType, amount, high, wind);
  return {
    pattern: patternInfo.pattern, pattern_day: patternInfo.day,
    total_day_length_hours: total, daylight_hours: daylight, darkness_hours: darkness,
    temperature_low_c: low, temperature_high_c: high, temperature_current_c: round((low + high) / 2, 1),
    sky_condition: sky, wind_speed_kmh: wind, wind_gust_kmh: gust, wind_direction: direction,
    precipitation_type: precipitationType, precipitation_intensity: intensity, precipitation_amount_mm: amount,
    fog, snow_depth_cm: snowDepth, new_snow_cm: newSnow, snow_loss_cm: snowLoss,
    ice_accumulation_mm: ice, new_ice_mm: newIce, ice_loss_mm: iceLoss,
  };
}

function weatherPattern(random: SeededRandom, previous: JsonObject, season: JsonObject, thaena: boolean) {
  if (!previous.pattern) return { pattern: season.name === "dark" ? "snow_period" : "cloudy_calm", day: 1 };
  const current = String(previous.pattern);
  const day = Number(previous.pattern_day);
  const spec = PATTERNS[current] ?? PATTERNS.cloudy_calm!;
  const change = day >= spec.max || (day >= spec.min && random.next() < 1 / Math.max(1, spec.typical));
  if (!change) return { pattern: current, day: day + 1 };
  let choices = [...spec.next];
  if (thaena && ["cloudy_calm", "cooling", "wet_period", "snow_period"].includes(current)) {
    choices.push("storm_building", "storm_building");
  }
  if (season.name === "dark") choices = choices.map((item) => item === "wet_period" ? "snow_period" : item);
  return { pattern: random.choice(choices), day: 1 };
}

function temperature(random: SeededRandom, previous: JsonObject, season: JsonObject, pattern: string, thaena: boolean): [number, number] {
  const bands: Record<string, [number, number]> = {
    light: [-5, 16], dark_onset: [-30, 2], dark_established: [-50, -12], dark_deep: [-70, -30],
  };
  const key = season.name === "light" ? "light" : `dark_${String(season.phase)}`;
  const [targetLow, targetHigh] = bands[key] ?? bands.dark_established!;
  let midpoint = random.uniform(targetLow, targetHigh);
  if (typeof previous.temperature_current_c === "number") {
    const drift = 4 * (thaena ? 1.5 : 1);
    const tendency = ({ warming: 2, cooling: -2, storm_building: -1 } as Record<string, number>)[pattern] ?? 0;
    midpoint = previous.temperature_current_c + clamp(
      (midpoint - previous.temperature_current_c) * 0.15 + tendency + random.uniform(-1.2, 1.2), -drift, drift,
    );
  }
  const span = random.uniform(4, 11);
  const low = Math.max(-78, midpoint - span / 2);
  return [round(low, 1), round(Math.max(low, midpoint + span / 2), 1)];
}

function light(random: SeededRandom, previous: JsonObject, season: JsonObject): [number, number, number] {
  const target = 34.5 + 7.5 * Math.sin((Number(season.cycle_day) / 600) * Math.PI * 2);
  let total = typeof previous.total_day_length_hours === "number"
    ? previous.total_day_length_hours + clamp((target - previous.total_day_length_hours) * 0.12, -0.5, 0.5)
    : target;
  total = round(clamp(total, 24, 45), 1);
  const transition = season.transition_active ? Number(season.transition_strength) : 0;
  if (season.name === "dark") {
    let daylight = random.uniform(0, season.phase === "deep" ? 2 : 6);
    if (transition) daylight = Math.min(6, daylight + transition * 2);
    daylight = round(daylight, 1);
    return [total, daylight, round(total - daylight, 1)];
  }
  let darkness = random.uniform(0, 6);
  if (transition) darkness = Math.min(6, darkness + transition * 2);
  darkness = round(darkness, 1);
  return [total, round(total - darkness, 1), darkness];
}

function skyCondition(previous: JsonObject, pattern: string): string {
  const target = ({ clear_stable: 0, warming: 1, fog_period: 2, cloudy_calm: 2, cooling: 2,
    wet_period: 3, snow_period: 3, storm_building: 4, active_storm: 4, storm_weakening: 3 } as Record<string, number>)[pattern] ?? 2;
  if (typeof previous.sky_condition !== "string") return SKIES[target]!;
  const prior = SKIES.indexOf(previous.sky_condition);
  return SKIES[prior + (target > prior ? 1 : target < prior ? -1 : 0)] ?? SKIES[target]!;
}

function windState(random: SeededRandom, previous: JsonObject, pattern: string, thaena: boolean): [number, number, string] {
  const ranges: Record<string, [number, number]> = {
    storm_building: [25, 48], active_storm: [40, 75], storm_weakening: [18, 42], clear_stable: [2, 16], fog_period: [0, 10],
  };
  const [low, high] = ranges[pattern] ?? [8, 30];
  const target = random.integer(low, high) + (thaena ? random.integer(0, 8) : 0);
  let wind = target;
  let direction = random.choice(DIRECTIONS);
  if (typeof previous.wind_speed_kmh === "number" && typeof previous.wind_direction === "string") {
    const limit = thaena || pattern.includes("storm") ? 18 : 10;
    wind = previous.wind_speed_kmh + clamp(target - previous.wind_speed_kmh, -limit, limit);
    const old = Math.max(0, DIRECTIONS.indexOf(previous.wind_direction));
    direction = DIRECTIONS[(old + random.choice([-1, 0, 0, 1]) + 8) % 8]!;
  }
  const gust = wind + random.integer(3, Math.max(4, Math.floor(wind * 0.55) + 4));
  return [Math.max(0, Math.trunc(wind)), Math.trunc(gust), direction];
}

function precipitation(random: SeededRandom, pattern: string, sky: string, low: number, high: number): [string, string, number] {
  if (SKIES.indexOf(sky) < 3 || ["clear_stable", "warming", "cooling", "fog_period"].includes(pattern)) return ["none", "none", 0];
  const chance = ["wet_period", "snow_period", "active_storm"].includes(pattern) ? 0.85 : 0.45;
  if (random.next() > chance) return ["none", "none", 0];
  const type = high < -2 ? "snow" : low <= 1 && high >= 1 ? random.choice(["wet_snow", "freezing_rain", "mixed"]) : "rain";
  const intensity = random.choice(pattern === "active_storm" ? ["light", "moderate", "heavy"] : ["trace", "light", "moderate"]);
  const base = ({ trace: 0.3, light: 3, moderate: 9, heavy: 18 } as Record<string, number>)[intensity]!;
  return [type, intensity, round(base * random.uniform(0.7, 1.3), 1)];
}

function fogState(random: SeededRandom, pattern: string, wind: number, precipitationType: string, low: number): string {
  if (wind > 28) return "none";
  const chance = pattern === "fog_period" ? 0.65 : precipitationType !== "none" ? 0.18 : 0.04;
  if (random.next() > chance) return "none";
  if (low < -30) return "ice_fog";
  if (low < 0) return "freezing_fog";
  return random.choice(wind < 10 ? ["light", "moderate", "dense"] : ["light", "moderate"]);
}

function accumulation(random: SeededRandom, previous: JsonObject, type: string, amount: number, high: number, wind: number): number[] {
  const priorSnow = Number(previous.snow_depth_cm ?? 0);
  const priorIce = Number(previous.ice_accumulation_mm ?? 0);
  const newSnow = ["snow", "wet_snow"].includes(type) ? round(amount * random.uniform(0.8, 1.5), 1) : 0;
  const newIce = ["freezing_rain", "ice_pellets", "mixed"].includes(type) ? round(amount * random.uniform(0.15, 0.45), 1) : 0;
  const snowLoss = round(Math.min(priorSnow, Math.max(0, high) * 0.35 + Math.max(0, wind - 40) * 0.015 + (priorSnow ? random.uniform(0, 0.15) : 0)), 1);
  const iceLoss = round(Math.min(priorIce, Math.max(0, high) * 0.45), 1);
  return [round(Math.max(0, priorSnow + newSnow - snowLoss), 1), newSnow, snowLoss,
    round(Math.max(0, priorIce + newIce - iceLoss), 1), newIce, iceLoss];
}

function generateEstrus(config: Config, day: number, recent: EnvironmentState[], season: JsonObject): JsonObject {
  const random = rng(config, day, "estrus");
  let streak = 0;
  for (const item of [...recent].reverse()) {
    if (item.estrus.status !== "likely") break;
    streak += 1;
  }
  if (streak) {
    const duration = rng(config, day - streak, "estrus-episode-duration").integer(4, 7);
    return { status: streak < duration ? "likely" : "unlikely" };
  }
  if (recent.slice(-18).some((item) => item.estrus.status === "likely")) return { status: "unlikely" };
  let probability = 0.006;
  if (season.name === "light" && (["unsettled", "fading"].includes(String(season.phase)) || season.transition_active)) {
    probability = 0.32 + (season.transition_active ? Number(season.transition_strength) * 0.45 : 0);
  }
  else if (season.name === "dark") probability = ({ onset: 0.12, established: 0.025, deep: 0.004 } as Record<string, number>)[String(season.phase)] ?? probability;
  return { status: random.next() < probability ? "likely" : "unlikely" };
}

function transitionProbability(day: number, window: number[], abnormality: number): number {
  const [start, end] = window as [number, number];
  if (day >= start && day <= end) return 0.02 + 0.28 * ((day - start) / Math.max(1, end - start)) ** 2;
  return day >= start - 20 && day < start ? abnormality : 0;
}

function seasonPhase(name: string, day: number, transitioning: boolean): string {
  if (name === "light") return transitioning ? "fading" : day < 160 ? "returning" : day > 330 ? "unsettled" : "established";
  return transitioning ? "weakening" : day >= 520 || day <= 35 ? "deep" : day < 100 ? "weakening" : day < 480 ? "onset" : "established";
}

function addDay(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function isLeap(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
function round(value: number, digits: number): number { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
