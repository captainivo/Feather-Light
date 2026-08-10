export interface MoodVector {
  valence: number;
  energy: number;
  connection: number;
  arousal: number;
}

export interface SeasonDigest {
  name: string;
  phase: string;
  days_in: number;
}

export interface WeatherDigest {
  temp_c: number;
  wind_kmh: number;
  snow_cm: number;
  sky: string;
  daylight_hours: number;
}

export interface StateDigest {
  generated_at: string;
  season: SeasonDigest | null;
  weather: WeatherDigest | null;
  mood: MoodVector;
  cues: string[];
  estrus_phase: string | null;
  outfit: {
    indoor: string;
    outdoor: string;
  };
  possessions: {
    count: number;
    pending_gift_reviews: number;
  };
}

export interface HealthDigest {
  as_of: string;
  signs: Record<string, { level: string; note: string }>;
}

export interface ShelvesDigest {
  growth: {
    active: number;
    by_kind: Record<string, number>;
  };
  longing: {
    private_held: number;
    shared_held: number;
    released: number;
  };
}

export interface AgencyDigest {
  directives: {
    active: number;
    by_kind: Record<string, number>;
  };
  open_hand: {
    pending: number;
    applied: number;
  };
}

