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
});
