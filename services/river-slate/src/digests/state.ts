import type { Config } from "../config.js";
import type { FeatherDatabase } from "../db.js";
import { latestEnvironmentDay } from "../readers/environment.js";
import { readHealthCard } from "../readers/healthCard.js";
import type { MoodVector, StateDigest } from "../types.js";

/**
 * The aauthora service holds Mithra's live emotional state — updated when she
 * records an appraisal, not on the hourly health-card cadence. When it
 * answers, its mood/cues/estrus override the card snapshot so the digest is
 * as fresh as the river actually is. On any failure we fall back to the card.
 */
interface LiveEmotionalState {
  as_of?: string;
  mood?: Partial<MoodVector>;
  cues?: string[];
  estrus_phase?: string | null;
}

async function fetchLiveEmotionalState(baseUrl: string): Promise<LiveEmotionalState | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/emotional-state`, {
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LiveEmotionalState;
    const m = data.mood ?? {};
    if ([m.valence, m.energy, m.connection, m.arousal].some((v) => typeof v !== "number")) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function buildStateDigest(config: Config, db: FeatherDatabase): Promise<StateDigest> {
  const card = readHealthCard(config.healthCardDir);
  const env = latestEnvironmentDay(db);
  const emotion = card.current.emotional_state;
  const cardMood: MoodVector = emotion.mood ?? {
    valence: emotion.valence,
    energy: emotion.energy,
    connection: emotion.connection,
    arousal: emotion.arousal,
  };

  const live = await fetchLiveEmotionalState(config.aauthoraApiBaseUrl);
  const liveMood: MoodVector | null = live?.mood
    ? {
        valence: live.mood.valence ?? cardMood.valence,
        energy: live.mood.energy ?? cardMood.energy,
        connection: live.mood.connection ?? cardMood.connection,
        arousal: live.mood.arousal ?? cardMood.arousal,
      }
    : null;

  return {
    generated_at: live?.as_of ?? env?.generated_at ?? card.generated_at,
    season: env
      ? {
          name: env.season.name,
          phase: env.season.phase,
          days_in: env.season.days_in_current_season,
        }
      : null,
    weather: env
      ? {
          temp_c: env.weather.temperature_current_c,
          wind_kmh: env.weather.wind_speed_kmh,
          snow_cm: env.weather.snow_depth_cm,
          sky: env.weather.sky_condition,
          daylight_hours: env.weather.daylight_hours,
        }
      : null,
    mood: liveMood ?? cardMood,
    cues: live?.cues ?? emotion.cues,
    estrus_phase:
      live?.estrus_phase !== undefined ? live.estrus_phase : (emotion.estrus_phase ?? null),
    outfit: {
      indoor: card.current.outfit.indoor_summary,
      outdoor: card.current.outfit.outdoor_summary,
    },
    possessions: {
      count: card.current.possessions?.possession_count ?? 0,
      pending_gift_reviews: card.current.possessions?.pending_gift_reviews ?? 0,
    },
  };
}

