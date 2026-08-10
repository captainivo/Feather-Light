import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config.js";
import { openReadonly } from "../../src/db.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("River-Slate portable boundary", () => {
  it("accepts container-safe paths and service addresses through configuration", () => {
    expect(loadConfig({
      RIVER_SLATE_PORT: "8422",
      RIVER_SLATE_BIND: "127.0.0.1",
      HEALTH_CARD_DIR: "/state/health-card",
      FEATHER_LIGHT_DB: "/state/feather-light.sqlite3",
      AUTHORA_API_BASE_URL: "http://127.0.0.1:8421",
    })).toMatchObject({
      port: 8422,
      healthCardDir: "/state/health-card",
      featherLightDb: "/state/feather-light.sqlite3",
    });
  });

  it("opens shared state strictly read-only", () => {
    const directory = mkdtempSync(join(tmpdir(), "river-slate-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.sqlite3");
    const writer = new Database(path);
    writer.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('synthetic')");
    writer.close();
    const reader = openReadonly(path);
    expect(reader.prepare("SELECT value FROM sample").pluck().get()).toBe("synthetic");
    expect(() => reader.exec("INSERT INTO sample VALUES ('forbidden')")).toThrow();
    reader.close();
  });
});
