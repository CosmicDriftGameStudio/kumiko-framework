import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDeployDrift, render, scaffoldDeploy } from "../scaffold-deploy.js";

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
    expect(migrate).toContain('postgresql://myapp:$(urlencode "$DB_PASSWORD")@db:5432/myapp');
    // The password-bearing URL is composed into the shell env and passed by
    // NAME (`-e DATABASE_URL`, no `=`), so the expanded value never lands in
    // `docker run`'s argv (would be visible in `ps auxe`).
    expect(migrate).toContain("export DATABASE_URL=");
    expect(migrate).toMatch(/-e DATABASE_URL\b(?!=)/);
    expect(migrate).not.toContain('-e DATABASE_URL="postgresql://myapp:');
    expect(migrate).toMatch(/STACK_NETWORK="\$\{COMPOSE_PROJECT\}_stack"/);
    // A COMPOSE_PROJECT_NAME from .env must decide the network, so it is read first.
    expect(migrate.indexOf(". ./.env")).toBeGreaterThan(-1);
    expect(migrate.indexOf(". ./.env")).toBeLessThan(migrate.indexOf("COMPOSE_PROJECT="));
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

  it("Dockerfile copies kumiko/migrations and is free of stale drizzle artefacts", () => {
    // Regression guard for PR #167 deploy-template drift: after the drizzle
    // replacement (framework 0.21) + single-bundle server build (0.20), the
    // template kept three dead drizzle references that broke fresh deploys —
    // a COPY for the unbundled drizzle.config.ts, a COPY of /app/drizzle
    // (apps now ship kumiko/), and a KUMIKO_MIGRATION_HOOKS env pointing at
    // a no-longer-bundled migration-hooks.js. The migrate path is now
    // `kumiko schema apply` reading ${INIT_CWD}/kumiko/migrations/*.sql.
    scaffoldDeploy({ appName: "drift-guard", destination: tmp });
    const dockerfile = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");

    expect(dockerfile).toContain(
      "COPY --from=build --chown=app:app /app/kumiko/migrations ./kumiko/migrations",
    );

    expect(dockerfile).not.toContain("/app/dist-server/drizzle.config.ts");
    expect(dockerfile).not.toContain("COPY --from=build --chown=app:app /app/drizzle ./drizzle");
    expect(dockerfile).not.toContain("KUMIKO_MIGRATION_HOOKS");
    expect(dockerfile).not.toContain("migration-hooks.js");
  });

  it("migrate-step.sh invokes the schema-CLI subcommand registered in kumiko.ts", () => {
    // Regression guard for PR #167: the deploy step was calling
    // `bun /app/kumiko.js migrate apply`, but the CLI only registers
    // `schema` (with subcommand `apply`). The pre-deploy migrate step
    // crashed with "Unknown command: migrate" until this was fixed.
    scaffoldDeploy({ appName: "cli-cmd", destination: tmp });
    const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
    expect(migrate).toContain("bun /app/kumiko.js schema apply");
    expect(migrate).not.toContain("kumiko.js migrate apply");
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

  describe("render placeholder consumption", () => {
    it("passes Docker/Go template syntax {{.X}} through verbatim", () => {
      const out = render('docker network ls --format "{{.Name}}"', {}, {});
      expect(out).toBe('docker network ls --format "{{.Name}}"');
    });

    it("substitutes known {{key}} placeholders", () => {
      expect(render("hello {{who}}", { who: "world" }, {})).toBe("hello world");
    });

    it("throws on an orphan close-tag (no opener) instead of leaking it", () => {
      expect(() => render("line\n{{/hasSeeds}}\nmore", {}, {})).toThrow(/unconsumed mustache/);
    });

    it("strips a matched block but does not leave its close-tag behind", () => {
      const out = render("a\n{{#flag}}\nkept\n{{/flag}}\nb", {}, { flag: true });
      expect(out).toContain("kept");
      expect(out).not.toContain("{{/flag}}");
    });
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

    it("rejects @cosmicdriftgamestudio/* deps without a bunfig.toml/.npmrc scope config", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          name: "noregistry",
          dependencies: { "@cosmicdriftgamestudio/kumiko-ai-foundation": "^0.2.0" },
        }),
      );
      expect(() => scaffoldDeploy({ appName: "noregistry", destination: tmp })).toThrow(
        /bunfig\.toml or \.npmrc/,
      );
    });

    it("emits GITHUB_TOKEN blocks when @cosmicdriftgamestudio/* dep is present", () => {
      writeFileSync(join(tmp, "bunfig.toml"), "");
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
      expect(df).toContain("ARG NPM_AUTH_TOKEN=");
      expect(df).toContain("ARG NPM_AUTH_TOKEN\n");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell variable expansion, not a JS template
      expect(df).toContain("ENV GITHUB_TOKEN=${NPM_AUTH_TOKEN}");
    });

    it("skips NPM_AUTH_TOKEN blocks when only public @cosmicdrift/* deps are present", () => {
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
      expect(df).not.toContain("ARG NPM_AUTH_TOKEN");
      expect(df).not.toContain("ENV GITHUB_TOKEN");
    });

    it("manifests app with bunfig.toml: NPM_AUTH_TOKEN wiring + manifests-first COPY", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          name: "manifestapp",
          dependencies: { "@cosmicdriftgamestudio/kumiko-ai-foundation": "^0.2.0" },
        }),
      );
      writeFileSync(join(tmp, "bunfig.toml"), "[install.scopes]\n");
      const result = scaffoldDeploy({ appName: "manifestapp", destination: tmp });
      expect(result.detected.installFromFullTree).toBe(false);
      expect(result.detected.registryConfigFiles).toEqual(["bunfig.toml"]);
      const df = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
      expect(df).toContain("ARG NPM_AUTH_TOKEN=");
      expect(df).toContain("ARG NPM_AUTH_TOKEN\n");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell variable expansion, not a JS template
      expect(df).toContain("ENV GITHUB_TOKEN=${NPM_AUTH_TOKEN}");
      expect(df).toContain(
        "COPY package.json bun.lock bunfig.toml ./\nRUN bun install --frozen-lockfile",
      );
      expect(df).toMatch(
        /FROM .* AS runtime\n(?:#[^\n]*\n)*ARG BUILD_VERSION=dev\nARG BUILD_TIME=unknown/,
      );
    });

    it(".npmrc-only app copies .npmrc before install", () => {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "npmrcapp" }));
      writeFileSync(
        join(tmp, ".npmrc"),
        "@cosmicdriftgamestudio:registry=https://npm.pkg.github.com\n",
      );
      const result = scaffoldDeploy({ appName: "npmrcapp", destination: tmp });
      expect(result.detected.registryConfigFiles).toEqual([".npmrc"]);
      const df = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
      expect(df).toContain("COPY package.json bun.lock .npmrc ./");
    });

    it("a workspaces app renders COPY . . before install (full-tree)", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "wsapp", workspaces: ["packages/*"] }),
      );
      const result = scaffoldDeploy({ appName: "wsapp", destination: tmp });
      expect(result.detected.installFromFullTree).toBe(true);
      const df = readFileSync(join(tmp, "deploy", "Dockerfile"), "utf-8");
      expect(df).toContain("COPY . .\nRUN bun install --frozen-lockfile\nRUN bun run build");
      expect(df).not.toContain("COPY package.json bun.lock");
    });

    it("a file:/workspace:/link: dependency spec triggers full-tree install without a workspaces field", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "localdepapp", dependencies: { "@app/define": "file:./.kumiko" } }),
      );
      const result = scaffoldDeploy({ appName: "localdepapp", destination: tmp });
      expect(result.detected.installFromFullTree).toBe(true);
    });
  });

  describe("kumiko.deploy config", () => {
    it("no kumiko.deploy → migrate-step uses appName as db user and the exact-name network", () => {
      scaffoldDeploy({ appName: "plainapp", destination: tmp });
      const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
      expect(migrate).toContain(
        'postgresql://plainapp:$(urlencode "$DB_PASSWORD")@db:5432/plainapp',
      );
      expect(migrate).toContain("basename");
      expect(migrate).toContain("docker network inspect");
      expect(migrate).not.toContain("docker network ls");
    });

    it('dbUser "kumiko" substitutes only the DB-URL user, db name stays appName', () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "dbuserapp", kumiko: { deploy: { dbUser: "kumiko" } } }),
      );
      scaffoldDeploy({ appName: "dbuserapp", destination: tmp });
      const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
      expect(migrate).toContain(
        'postgresql://kumiko:$(urlencode "$DB_PASSWORD")@db:5432/dbuserapp',
      );
    });

    it("without dbName the DB-URL database stays appName and no override comment is rendered", () => {
      scaffoldDeploy({ appName: "defaultdbapp", destination: tmp });
      const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
      expect(migrate).toContain('@db:5432/defaultdbapp"');
      expect(migrate).not.toContain("kumiko.deploy.dbName");
    });

    it("dbName substitutes only the DB-URL database, user stays appName", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "dbnameapp", kumiko: { deploy: { dbName: "legacy_db" } } }),
      );
      scaffoldDeploy({ appName: "dbnameapp", destination: tmp });
      const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
      expect(migrate).toContain(
        'postgresql://dbnameapp:$(urlencode "$DB_PASSWORD")@db:5432/legacy_db"',
      );
      expect(migrate).toContain("package.json#kumiko.deploy.dbName");
    });

    it("dbName and dbUser can be set together", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          name: "bothapp",
          kumiko: { deploy: { dbUser: "kumiko", dbName: "kumiko_prod" } },
        }),
      );
      const result = scaffoldDeploy({ appName: "bothapp", destination: tmp });
      expect(result.detected).toMatchObject({ dbUser: "kumiko", dbName: "kumiko_prod" });
    });

    it('stackNetwork "directory" still scaffolds the same exact-name network lookup', () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "dirapp", kumiko: { deploy: { stackNetwork: "directory" } } }),
      );
      scaffoldDeploy({ appName: "dirapp", destination: tmp });
      const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
      expect(migrate).toContain("basename");
      expect(migrate).toContain("docker network inspect");
      expect(migrate).not.toContain("docker network ls");
    });

    describe('stackNetwork "directory" executed against a fake docker', () => {
      function runMigrateStep(
        projectDir: string,
        env: Record<string, string>,
      ): { readonly status: number; readonly inspected: string } {
        const binDir = join(tmp, "bin");
        mkdirSync(binDir, { recursive: true });
        const inspectLog = join(tmp, "inspected.log");
        writeFileSync(
          join(binDir, "docker"),
          [
            "#!/bin/sh",
            'if [ "$1 $2" = "network inspect" ]; then',
            `  echo "$3" >> "${inspectLog}"`,
            '  case "$3" in myapp_stack|custom_stack) exit 0 ;; *) exit 1 ;; esac',
            "fi",
            "exit 0",
            "",
          ].join("\n"),
          { mode: 0o755 },
        );
        writeFileSync(join(projectDir, ".env"), "DB_PASSWORD=pw\n");
        const proc = Bun.spawnSync(["bash", join(projectDir, "migrate-step.sh")], {
          cwd: projectDir,
          env: { PATH: `${binDir}:${process.env["PATH"] ?? ""}`, ...env },
          stderr: "pipe",
        });
        return {
          status: proc.exitCode,
          inspected: existsSync(inspectLog) ? readFileSync(inspectLog, "utf-8").trim() : "",
        };
      }

      function scaffoldInto(projectDir: string): void {
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(
          join(projectDir, "package.json"),
          JSON.stringify({ name: "dirapp", kumiko: { deploy: { stackNetwork: "directory" } } }),
        );
        scaffoldDeploy({ appName: "dirapp", destination: projectDir });
        writeFileSync(
          join(projectDir, "migrate-step.sh"),
          readFileSync(join(projectDir, "deploy", "migrate-step.sh"), "utf-8"),
        );
      }

      it("lowercases and sanitises the directory name like compose does", () => {
        const projectDir = join(tmp, "My App!");
        scaffoldInto(projectDir);
        const { status, inspected } = runMigrateStep(projectDir, {});
        expect(inspected).toBe("myapp_stack");
        expect(status).toBe(0);
      });

      it("prefers COMPOSE_PROJECT_NAME over the directory name", () => {
        const projectDir = join(tmp, "srv-dir");
        scaffoldInto(projectDir);
        const { status, inspected } = runMigrateStep(projectDir, {
          COMPOSE_PROJECT_NAME: "custom",
        });
        expect(inspected).toBe("custom_stack");
        expect(status).toBe(0);
      });
    });

    it("percent-encodes URL-reserved characters of DB_PASSWORD in DATABASE_URL", () => {
      const projectDir = join(tmp, "pwapp");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(projectDir, "package.json"),
        JSON.stringify({ name: "pwapp", kumiko: { deploy: { stackNetwork: "directory" } } }),
      );
      scaffoldDeploy({ appName: "pwapp", destination: projectDir });
      const binDir = join(tmp, "bin-pw");
      mkdirSync(binDir, { recursive: true });
      const urlLog = join(tmp, "database-url.log");
      writeFileSync(
        join(binDir, "docker"),
        [
          "#!/bin/sh",
          `[ "$1" = "run" ] && printf '%s' "$DATABASE_URL" > "${urlLog}"`,
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      writeFileSync(join(projectDir, ".env"), "DB_PASSWORD='p@ss:w/rd#%ä'\n");

      const proc = Bun.spawnSync(["bash", join(projectDir, "deploy", "migrate-step.sh")], {
        cwd: projectDir,
        env: { PATH: `${binDir}:${process.env["PATH"] ?? ""}` },
        stderr: "pipe",
      });

      expect(proc.exitCode).toBe(0);
      expect(readFileSync(urlLog, "utf-8")).toBe(
        "postgresql://pwapp:p%40ss%3Aw%2Frd%23%25%C3%A4@db:5432/pwapp",
      );
    });

    it.each(["a;rm -rf /", "$(id)", "a b", ""])(
      "rejects invalid dbUser %j, naming the field",
      (dbUser) => {
        writeFileSync(
          join(tmp, "package.json"),
          JSON.stringify({ name: "invaliddbuser", kumiko: { deploy: { dbUser } } }),
        );
        expect(() => scaffoldDeploy({ appName: "invaliddbuser", destination: tmp })).toThrow(
          /dbUser/,
        );
      },
    );

    it.each(["a;rm -rf /", "$(id)", "a b", ""])(
      "rejects invalid dbName %j, naming the field",
      (dbName) => {
        writeFileSync(
          join(tmp, "package.json"),
          JSON.stringify({ name: "invaliddbname", kumiko: { deploy: { dbName } } }),
        );
        expect(() => scaffoldDeploy({ appName: "invaliddbname", destination: tmp })).toThrow(
          /kumiko\.deploy\.dbName/,
        );
      },
    );

    it("an over-long appName without deploy config blames appName, not kumiko.deploy.dbUser", () => {
      const appName = "a".repeat(64);
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: appName }));
      expect(() => scaffoldDeploy({ appName, destination: tmp })).toThrow(
        /appName ".*" cannot serve as the default DB user/,
      );
    });

    it("rejects an invalid stackNetwork value", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "invalidnet", kumiko: { deploy: { stackNetwork: "foo" } } }),
      );
      expect(() => scaffoldDeploy({ appName: "invalidnet", destination: tmp })).toThrow(
        /stackNetwork/,
      );
    });

    it('rejects the removed stackNetwork "discover" and says the option was removed', () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "discoverapp", kumiko: { deploy: { stackNetwork: "discover" } } }),
      );
      expect(() => scaffoldDeploy({ appName: "discoverapp", destination: tmp })).toThrow(
        /stackNetwork option was removed/,
      );
    });

    it("rejects an unknown key under kumiko.deploy (strict)", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "unknownkey", kumiko: { deploy: { dbHost: "elsewhere" } } }),
      );
      expect(() => scaffoldDeploy({ appName: "unknownkey", destination: tmp })).toThrow(/dbHost/);
    });
  });

  describe("checkDeployDrift", () => {
    it("reports missing when no deploy files exist yet", () => {
      const result = checkDeployDrift({ appName: "driftapp", destination: tmp });
      expect(result.drifted).toHaveLength(3);
      expect(result.drifted.every((d) => d.reason === "missing")).toBe(true);
    });

    it("reports differs when an on-disk file no longer matches the rendered content", () => {
      scaffoldDeploy({ appName: "driftapp", destination: tmp });
      writeFileSync(join(tmp, "deploy", "Dockerfile"), "# hand-edited, drifted");
      const result = checkDeployDrift({ appName: "driftapp", destination: tmp });
      expect(result.drifted).toEqual([
        { path: join(tmp, "deploy", "Dockerfile"), reason: "differs" },
      ]);
    });

    it("reports no drift right after a fresh scaffold", () => {
      scaffoldDeploy({ appName: "driftapp", destination: tmp });
      const result = checkDeployDrift({ appName: "driftapp", destination: tmp });
      expect(result.drifted).toHaveLength(0);
    });

    it("reports no drift for a scaffold rendered with a kumiko.deploy config", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "driftconfigapp", kumiko: { deploy: { dbUser: "kumiko" } } }),
      );
      scaffoldDeploy({ appName: "driftconfigapp", destination: tmp });
      const result = checkDeployDrift({ appName: "driftconfigapp", destination: tmp });
      expect(result.drifted).toHaveLength(0);
    });

    it("reports differs on migrate-step.sh after package.json's dbUser changes", () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "driftconfigapp", kumiko: { deploy: { dbUser: "kumiko" } } }),
      );
      scaffoldDeploy({ appName: "driftconfigapp", destination: tmp });
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "driftconfigapp", kumiko: { deploy: { dbUser: "otheruser" } } }),
      );
      const result = checkDeployDrift({ appName: "driftconfigapp", destination: tmp });
      expect(result.drifted).toEqual([
        { path: join(tmp, "deploy", "migrate-step.sh"), reason: "differs" },
      ]);
    });

    it("reports no drift when package.json adds the now-default stackNetwork directory", () => {
      scaffoldDeploy({ appName: "driftconfigapp", destination: tmp });
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          name: "driftconfigapp",
          kumiko: { deploy: { stackNetwork: "directory" } },
        }),
      );
      const result = checkDeployDrift({ appName: "driftconfigapp", destination: tmp });
      expect(result.drifted).toEqual([]);
    });
  });

  describe("malformed package.json", () => {
    it("warns + defaults to no private deps and manifests-first install (mis-detection is visible)", () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        writeFileSync(join(tmp, "package.json"), "{ this is not json");
        const result = scaffoldDeploy({ appName: "broken", destination: tmp });
        expect(result.detected.hasPrivateGhPackages).toBe(false);
        expect(result.detected.installFromFullTree).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("is not valid JSON");
      } finally {
        warn.mockRestore();
      }
    });

    it("keeps a valid kumiko.deploy config even when dependencies has an unexpected shape", () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        writeFileSync(
          join(tmp, "package.json"),
          JSON.stringify({
            name: "shapeissue",
            dependencies: "not-an-object",
            kumiko: { deploy: { dbUser: "kumiko" } },
          }),
        );
        const result = scaffoldDeploy({ appName: "shapeissue", destination: tmp });
        expect(result.detected.hasPrivateGhPackages).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        const migrate = readFileSync(join(tmp, "deploy", "migrate-step.sh"), "utf-8");
        expect(migrate).toContain(
          'postgresql://kumiko:$(urlencode "$DB_PASSWORD")@db:5432/shapeissue',
        );
      } finally {
        warn.mockRestore();
      }
    });
  });
});
