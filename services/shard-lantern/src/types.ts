export interface Inhabitant {
  slug: string;
  name: string;
  epithet: string | null;
  role: string;
  species: string;
  age: string | null;
  home: string;
  craft: string;
  personality: string;
  background: string;
  created_at: string;
}

export interface Routine {
  id: number;
  inhabitant_id: string;
  window_start: number;
  window_end: number;
  location: string;
  activity: string;
}

export interface LanternEvent {
  id: number;
  inhabitant_id: string | null;
  kind: string;
  text: string;
  at: string;
  earth_date: string;
}

export interface PulseEntry {
  slug: string;
  name: string;
  home: string;
  location: string;
  activity: string;
}

export interface Pulse {
  status: "ok" | "clock_unavailable";
  hour: number | null;
  day_length_hours: number;
  day_progress: number | null;
  inhabitants: PulseEntry[];
}

