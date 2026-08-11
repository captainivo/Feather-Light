import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";

function configFile(server: string): string {
  const directory = mkdtempSync(join(tmpdir(), "feather-config-"));
  const path = join(directory, "config.yaml");
  writeFileSync(path, `${server}\ndatabase:\n  path: "state.sqlite3"\narchiveRoots: []\n`);
  return path;
}

describe("server binding configuration", () => {
  it("allows loopback without an API token", () => {
    expect(loadConfig(configFile('server:\n  host: "127.0.0.1"')).server.host).toBe("127.0.0.1");
  });

  it("requires authentication for a private LAN binding", () => {
    expect(() => loadConfig(configFile('server:\n  host: "192.168.1.65"'))).toThrow(/authTokenFile/);
  });

  it("allows an authenticated private LAN binding", () => {
    const config = loadConfig(configFile('server:\n  host: "192.168.1.65"\n  authTokenFile: "api-token"'));
    expect(config.server.host).toBe("192.168.1.65");
    expect(config.server.authTokenFile).toMatch(/api-token$/);
  });

  it("allows an authenticated container wildcard binding", () => {
    const config = loadConfig(configFile('server:\n  host: "0.0.0.0"\n  authTokenFile: "api-token"'));
    expect(config.server.host).toBe("0.0.0.0");
  });

  it("rejects unauthenticated container wildcard bindings", () => {
    expect(() => loadConfig(configFile('server:\n  host: "0.0.0.0"'))).toThrow(/authTokenFile/);
  });
});

describe("container dependency overrides", () => {
  it("overrides Aauthora and Ollama with private-LAN endpoints", () => {
    const config = loadConfig(configFile('server:\n  host: "127.0.0.1"'), {
      AUTHORA_API_BASE_URL: "http://192.168.1.65:8421",
      OLLAMA_BASE_URL: "http://192.168.1.65:11434",
    });
    expect(config.aauthora.baseUrl).toBe("http://192.168.1.65:8421");
    expect(config.ollama.baseUrl).toBe("http://192.168.1.65:11434");
  });

  it("rejects public dependency endpoints", () => {
    expect(() => loadConfig(configFile('server:\n  host: "127.0.0.1"'), {
      AUTHORA_API_BASE_URL: "https://example.com",
    })).toThrow(/private LAN/);
  });
});
