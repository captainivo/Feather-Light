import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const emotionalStateSchema = z.object({
  as_of: z.string(),
  connection: z.number(),
  energy: z.number(),
  valence: z.number(),
  arousal: z.number(),
  cues: z.array(z.string()),
  estrus_phase: z.string().nullable(),
  mood: z
    .object({
      valence: z.number(),
      energy: z.number(),
      connection: z.number(),
      arousal: z.number(),
    })
    .optional(),
});

const currentSchema = z.object({
  generated_at: z.string(),
  emotional_state: emotionalStateSchema,
  outfit: z.object({
    indoor_summary: z.string(),
    outdoor_summary: z.string(),
  }),
  possessions: z
    .object({
      possession_count: z.number(),
      pending_gift_reviews: z.number(),
    })
    .optional(),
});

const healthCardSchema = z.object({
  generated_at: z.string(),
  current: currentSchema,
});

export type HealthCard = z.infer<typeof healthCardSchema>;

export function readHealthCard(dir: string): HealthCard {
  const raw = readFileSync(join(dir, "health_card.json"), "utf8");
  return healthCardSchema.parse(JSON.parse(raw));
}

