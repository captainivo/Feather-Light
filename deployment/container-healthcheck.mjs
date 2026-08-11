/* global process, console, fetch, AbortSignal */
const checks = [
  ["Granite-Wing", "http://127.0.0.1:8765/health"],
  ["River-Slate", "http://127.0.0.1:8422/healthz"],
  ["Shard-Lantern", "http://127.0.0.1:8423/healthz"],
];

for (const [name, url] of checks) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(`${name} health check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
