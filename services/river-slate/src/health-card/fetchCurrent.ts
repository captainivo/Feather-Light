import type { CurrentSnapshot } from "./types.js";

/** Fetch the current Aauthora conditions snapshot. Returns null on any failure. */
export async function fetchCurrent(baseUrl: string): Promise<CurrentSnapshot | null> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/current`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    return data as CurrentSnapshot;
  } catch {
    return null;
  }
}

