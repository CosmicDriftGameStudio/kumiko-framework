import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldDeploy } from "../scaffold-deploy";

describe("scaffoldDeploy", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "kumiko-deploy-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("generates Dockerfile, Dockerfile.dockerignore, migrate-step.sh", () => {
    const result = scaffoldDeploy({ appName: "myapp", destination: tmp });
    expect(result.destination).toBe(join(tmp, "deploy"));
    expect(result.files).toHaveLength(3);
    expect(result.files.every((f) => f.written)).toBe(true);
    expect(existsSync(join(tmp, "deploy", "Dockerfile"))).toBe(true);
    expect(existsSync(join(tmp, "deploy", "Dockerfile.dockerignore"))).toBe(true);
    expect(existsSync(join(tmp, "deploy", "migrate-step.sh"))).toBe(true);
  });

  it("substitutes {{appName}} + {{port}} + {{githubOrg}}", () => {
    scaffoldDeploy({
      appName: "myapp",
      port: 4242,
      githubOrg: "acme",
      destination: tmp,
    });
    const dockerfile = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("Production-Image for myapp");
    expect(dockerfile).toContain("ENV PORT=4242");
    expect(dockerfile).toContain("EXPOSE 4242");

    const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
    expect(migrate).toContain("myapp pre-deploy migrate step");
    expect(migrate).toContain("ghcr.io/acme/myapp:latest");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell-substitution literal, not a JS template
    expect(migrate).toContain("postgresql://myapp:${DB_PASSWORD}@db:5432/myapp");
    // Docker template syntax {{.Name}} must pass through verbatim — our
    // placeholder regex only matches lowercase-leading identifiers.
    expect(migrate).toContain('"{{.Name}}"');
  });

  it("uses defaults when port + githubOrg are omitted", () => {
    scaffoldDeploy({ appName: "minimal", destination: tmp });
    const dockerfile = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("ENV PORT=3000");
    expect(dockerfile).toContain("EXPOSE 3000");

    const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
    expect(migrate).toContain("ghcr.io/cosmicdriftgamestudio/minimal:latest");
  });

  it("Dockerfile emits inline start.sh (createBunServer command-override target)", () => {
    scaffoldDeploy({ appName: "boot-target", destination: tmp });
    const dockerfile = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
    // Inline RUN that creates a start.sh inside the runtime image.
    // bun-server.ts's createBunServer overrides the container command with
    // `exec ./start.sh` after injecting DATABASE_URL; without this line the
    // pod exited 127. Memory: `feedback_audit_drift_root_cause_now`.
    expect(dockerfile).toContain("> ./start.sh && chmod +x ./start.sh");
    expect(dockerfile).toContain("exec bun run server.js");
  });

  it("skips existing files by default", () => {
    const existing = join(tmp, "deploy");
    scaffoldDeploy({ appName: "first", destination: tmp });
    writeFileSync(join(existing, "Dockerfile"), "# user-tuned, do not touch");
    const second = scaffoldDeploy({ appName: "first", destination: tmp });
    const dockerfile = second.files.find((f) => f.path.endsWith("/Dockerfile"));
    expect(dockerfile?.written).toBe(false);
    expect(dockerfile?.reason).toBe("exists");
    expect(readFileSync(join(existing, "Dockerfile"), "utf-8")).toBe("# user-tuned, do not touch");
  });

  it("overwrites existing files with --force and tags reason='force'", () => {
    scaffoldDeploy({ appName: "first", destination: tmp });
    writeFileSync(join(tmp, "deploy", "Dockerfile"), "# old content");
    const second = scaffoldDeploy({ appName: "first", destination: tmp, force: true });
    const dockerfile = second.files.find((f) => f.path.endsWith("/Dockerfile"));
    expect(dockerfile?.written).toBe(true);
    expect(dockerfile?.reason).toBe("force");
    expect(readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8")).toContain(
      "Production-Image for first",
    );
  });

  it("force=true on a fresh directory leaves reason undefined (no clobber happened)", () => {
    // Regression guard: a clean first-time write with force=true must NOT
    // be tagged as `reason: "force"` — that label is reserved for actual
    // overwrites of pre-existing files. Fixed in self-review after the
    // initial implementation set `reason: "force"` unconditionally
    // post-write.
    const result = scaffoldDeploy({ appName: "fresh", destination: tmp, force: true });
    for (const f of result.files) {
      expect(f.written).toBe(true);
      expect(f.reason).toBeUndefined();
    }
  });

  it("rejects appName that isn't kebab-case", () => {
    expect(() => scaffoldDeploy({ appName: "MyApp", destination: tmp })).toThrow(/kebab-case/);
    expect(() => scaffoldDeploy({ appName: "my_app", destination: tmp })).toThrow(/kebab-case/);
    expect(() => scaffoldDeploy({ appName: "1app", destination: tmp })).toThrow(/kebab-case/);
  });

  it("rejects out-of-range port", () => {
    expect(() => scaffoldDeploy({ appName: "x", port: 0, destination: tmp })).toThrow(/1\.\.65535/);
    expect(() => scaffoldDeploy({ appName: "x", port: 70000, destination: tmp })).toThrow(
      /1\.\.65535/,
    );
  });

  describe("source-tree detection", () => {
    it("emits seeds-COPY block only when seeds/ exists", () => {
      // Without seeds/: block stripped
      const without = scaffoldDeploy({ appName: "noseeds", destination: tmp });
      expect(without.detected.hasSeeds).toBe(false);
      const dfNo = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
      expect(dfNo).not.toContain("COPY --from=build --chown=app:app /app/seeds ./seeds");
      expect(dfNo).not.toContain("ES-Operations seed migrations");
    });

    it("emits seeds-COPY block when seeds/ exists", () => {
      mkdirSync(join(tmp, "seeds"), { recursive: true });
      writeFileSync(join(tmp, "seeds", ".keep"), "");
      const result = scaffoldDeploy({ appName: "withseeds", destination: tmp });
      expect(result.detected.hasSeeds).toBe(true);
      const df = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
      expect(df).toContain("COPY --from=build --chown=app:app /app/seeds ./seeds");
      expect(df).toContain("ES-Operations seed migrations");
    });

    it("emits GITHUB_TOKEN blocks when @cosmicdriftgamestudio/* dep is present", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          name: "ghapp",
          dependencies: {
            "@cosmicdriftgamestudio/kumiko-ai-foundation": "^0.2.0",
          },
        }),
      );
      const result = scaffoldDeploy({ appName: "ghapp", destination: tmp });
      expect(result.detected.hasPrivateGhPackages).toBe(true);
      const df = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
      expect(df).toContain("ARG GITHUB_TOKEN=");
      expect(df).toContain("ARG GITHUB_TOKEN\n");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell variable expansion, not a JS template
      expect(df).toContain("ENV GITHUB_TOKEN=${GITHUB_TOKEN}");
    });

    it("skips GITHUB_TOKEN blocks when only public @cosmicdrift/* deps are present", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          name: "publicapp",
          dependencies: {
            "@cosmicdrift/kumiko-framework": "^0.8.0",
            "@cosmicdrift/kumiko-bundled-features": "^0.8.0",
          },
        }),
      );
      const result = scaffoldDeploy({ appName: "publicapp", destination: tmp });
      expect(result.detected.hasPrivateGhPackages).toBe(false);
      const df = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
      expect(df).not.toContain("ARG GITHUB_TOKEN");
      expect(df).not.toContain("ENV GITHUB_TOKEN");
    });

    it("malformed package.json doesn't crash detection (defaults to no private deps)", () => {
      writeFileSync(join(tmp, "package.json"), "{ this is not json");
      const result = scaffoldDeploy({ appName: "broken", destination: tmp });
      expect(result.detected.hasPrivateGhPackages).toBe(false);
    });
  });
});
