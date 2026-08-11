/* global process, console, fetch, AbortSignal */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const children = new Map();
let stopping = false;

function start(name, script, cwd) {
  const child = spawn(process.execPath, [script, "serve"], { cwd, env: process.env, stdio: "inherit" });
  children.set(name, child);
  child.once("exit", (code, signal) => {
    children.delete(name);
    if (!stopping) {
      console.error(`${name} exited unexpectedly (${signal ?? code ?? "unknown"})`);
      void shutdown(code ?? 1);
    }
  });
  return child;
}

async function waitForGranite() {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Granite-Wing is still starting or migrating its database.
    }
    await delay(500);
  }
  throw new Error("Granite-Wing did not become healthy within 20 seconds");
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const exits = [...children.values()].map((child) => new Promise((resolve) => child.once("exit", resolve)));
  for (const child of children.values()) child.kill("SIGTERM");
  await Promise.all(exits);
  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

try {
  start("Granite-Wing / Sky-Loom", "/app/granite-wing/dist/src/cli.js", "/app/granite-wing");
  await waitForGranite();
  start("River-Slate", "/app/services/river-slate/dist/src/cli.js", "/app/services/river-slate");
  start("Shard-Lantern", "/app/services/shard-lantern/dist/src/cli.js", "/app/services/shard-lantern");
} catch (error) {
  console.error(error);
  await shutdown(1);
}
