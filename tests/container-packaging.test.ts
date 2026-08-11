import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("container packaging", () => {
  it("runs as a non-root user and includes a process health check", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS runtime");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).not.toMatch(/COPY\s+\.\s+\./);
    expect(dockerfile).toContain("services/river-slate");
    expect(dockerfile).toContain("services/shard-lantern");
    expect(dockerfile).toContain("container-supervisor.mjs");
    expect(dockerfile).toContain("config.rehearsal.yaml");
  });

  it("mounts canon read-only and drops container capabilities", () => {
    const compose = parse(readFileSync("compose.yaml", "utf8")) as {
      services: Record<string, {
        read_only: boolean;
        cap_drop: string[];
        security_opt: string[];
        volumes: Array<Record<string, unknown>>;
      }>;
    };
    const service = compose.services["feather-light"];
    expect(service).toBeDefined();
    if (!service) throw new Error("feather-light service is missing");
    expect(service.read_only).toBe(true);
    expect(service.cap_drop).toContain("ALL");
    expect(service.security_opt).toContain("no-new-privileges:true");
    expect(service.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "/archive/westpole", read_only: true }),
      expect.objectContaining({ target: "/run/secrets/feather-light-api-token", read_only: true }),
    ]));
    expect(service.volumes).toEqual(expect.arrayContaining([
      "feather-light-state:/var/lib/feather-light",
      "river-slate-state:/var/lib/river-slate",
      "shard-lantern-state:/var/lib/shard-lantern",
    ]));
    expect(readFileSync("compose.yaml", "utf8")).toContain("OLLAMA_BASE_URL");
    expect(readFileSync("compose.yaml", "utf8")).toContain("AUTHORA_API_BASE_URL");
  });

  it("isolates the only archive writer without network access", () => {
    const compose = parse(readFileSync("compose.yaml", "utf8")) as { services: Record<string, Record<string, unknown>> };
    const writer = compose.services["archive-writer"] as {
      network_mode: string; read_only: boolean; command: string[];
      volumes: Array<string | Record<string, unknown>>; cap_drop: string[];
    };
    expect(writer.network_mode).toBe("none");
    expect(writer.read_only).toBe(true);
    expect(writer.command).toContain("archive-writer");
    expect(writer.cap_drop).toContain("ALL");
    const writerArchive = writer.volumes.find((volume) => typeof volume === "object" && volume.target === "/archive/westpole");
    expect(writerArchive).toBeDefined();
    expect(writerArchive).not.toHaveProperty("read_only", true);
    const mainArchive = (compose.services["feather-light"] as { volumes: Array<Record<string, unknown>> }).volumes;
    expect(mainArchive).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "/archive/westpole", read_only: true }),
    ]));
  });

  it("supervises and health-checks every packaged process without private seed data", () => {
    const supervisor = readFileSync("deployment/container-supervisor.mjs", "utf8");
    const healthcheck = readFileSync("deployment/container-healthcheck.mjs", "utf8");
    for (const component of ["Granite-Wing", "River-Slate", "Shard-Lantern"]) {
      expect(supervisor).toContain(component);
      expect(healthcheck).toContain(component);
    }
    expect(supervisor).toContain("await waitForGranite()");
    expect(readFileSync("compose.yaml", "utf8")).not.toContain("SHARD_LANTERN_SEED_FILE");
  });

  it("excludes private and generated archive material from build context", () => {
    const ignored = readFileSync(".dockerignore", "utf8");
    expect(ignored).toContain("config.yaml");
    expect(ignored).toContain("The Westpole");
    expect(ignored).toContain("story-archive-migration-*.json");
  });

  it("keeps the rehearsal API unauthenticated only on container loopback", () => {
    const rehearsal = parse(readFileSync("deployment/config.rehearsal.yaml", "utf8")) as {
      server: { host: string; authTokenFile?: string };
      archiveRoots: Array<{ path: string; readOnly: boolean }>;
    };
    expect(rehearsal.server.host).toBe("127.0.0.1");
    expect(rehearsal.server.authTokenFile).toBeUndefined();
    expect(rehearsal.archiveRoots).toEqual([
      expect.objectContaining({ path: "/archive/westpole", readOnly: true }),
    ]);
  });

  it("ships an Unraid manifest with the writer gated behind an explicit profile", () => {
    const compose = parse(readFileSync("deployment/compose.unraid.yaml", "utf8")) as {
      name: string;
      services: Record<string, { profiles?: string[]; network_mode?: string; volumes?: Array<string | Record<string, unknown>> }>;
    };
    expect(compose.name).toBe("feather_light");
    expect(compose.services["token-setup"]).toBeDefined();
    expect(compose.services["archive-writer"]?.profiles).toEqual(["archive-write"]);
    expect(compose.services["archive-writer"]?.network_mode).toBe("none");
    expect(compose.services["feather-light"]?.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "/archive/westpole", read_only: true }),
    ]));
  });
});
