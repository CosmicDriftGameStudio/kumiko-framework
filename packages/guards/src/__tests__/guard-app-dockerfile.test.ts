import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type AppDockerfileInput, check, inspectAppDockerfile } from "../guard-app-dockerfile";
import { fixtureRoot } from "./parent-workspace-fixture";

const BUNFIG =
  '[install.scopes]\n"@cosmicdriftgamestudio" = { url = "https://npm.pkg.github.com", token = "$GITHUB_TOKEN" }\n';
const NPMRC = `@cosmicdriftgamestudio:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=\${GITHUB_TOKEN}\n`;
const SECRET_MOUNT = "--mount=type=secret,id=npm_auth_token,env=GITHUB_TOKEN";

function dockerfile(buildStage: string, preamble = ""): string {
  return [
    "ARG BUILD_TIME=unknown",
    preamble,
    "FROM oven/bun:1.4.4-alpine AS build",
    "WORKDIR /app",
    buildStage,
    "RUN bun run build",
    "FROM oven/bun:1.4.4-alpine AS runtime",
    "COPY --from=build /app/dist-server ./",
    "RUN bun install --production --frozen-lockfile",
  ].join("\n");
}

const SECRET_DOCKERFILE = dockerfile(
  `COPY package.json bun.lock bunfig.toml ./\nRUN ${SECRET_MOUNT} bun install --frozen-lockfile`,
);
const LEGACY_DOCKERFILE = dockerfile(
  `ARG NPM_AUTH_TOKEN\nENV GITHUB_TOKEN=\${NPM_AUTH_TOKEN}\nCOPY . .\nRUN bun install --frozen-lockfile`,
  "ARG NPM_AUTH_TOKEN=",
);

function input(overrides: Partial<AppDockerfileInput>): AppDockerfileInput {
  return {
    dockerfileText: SECRET_DOCKERFILE,
    hasPrivateScopeDependency: true,
    bunfigText: BUNFIG,
    npmrcText: undefined,
    hasIndexHtml: true,
    ...overrides,
  };
}

describe("inspectAppDockerfile", () => {
  test("secret mount exposed as the variable bunfig reads: clean", () => {
    expect(inspectAppDockerfile(input({}))).toEqual({ violations: [], warnings: [] });
  });

  test("mount split over a line continuation with reordered options still counts", () => {
    const text = dockerfile(
      "COPY . .\nRUN --mount=env=GITHUB_TOKEN,id=npm_auth_token,type=secret \\\n  bun install --frozen-lockfile",
    );
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([]);
  });

  test("inline assignment from /run/secrets counts as exposing the token", () => {
    const text = dockerfile(
      "COPY . .\nRUN --mount=type=secret,id=npm_auth_token GITHUB_TOKEN=$(cat /run/secrets/npm_auth_token) bun install",
    );
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([]);
  });

  test("mount under a variable the registry config does not read is a violation", () => {
    const text = SECRET_DOCKERFILE.replace("env=GITHUB_TOKEN", "env=NPM_AUTH_TOKEN");
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([
      expect.stringContaining("does not mount the registry token"),
    ]);
  });

  test("mount with another id or a non-secret mount does not count", () => {
    for (const mount of [
      "--mount=type=secret,id=other,env=GITHUB_TOKEN",
      "--mount=type=cache,id=npm_auth_token,env=GITHUB_TOKEN",
    ]) {
      const text = SECRET_DOCKERFILE.replace(SECRET_MOUNT, mount);
      expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toHaveLength(1);
    }
  });

  test("legacy ARG path passes with a warning while apps migrate", () => {
    const findings = inspectAppDockerfile(input({ dockerfileText: LEGACY_DOCKERFILE }));
    expect(findings.violations).toEqual([]);
    expect(findings.warnings).toEqual([expect.stringContaining("lands in the image history")]);
  });

  test("legacy ARG only at the top, not re-declared in the build stage, is a violation", () => {
    const text = dockerfile("COPY . .\nRUN bun install --frozen-lockfile", "ARG NPM_AUTH_TOKEN=");
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([
      expect.stringContaining("does not mount the registry token"),
    ]);
  });

  test("secret mount next to an NPM_AUTH_TOKEN ARG is a violation", () => {
    const text = dockerfile(
      `ARG NPM_AUTH_TOKEN\nCOPY . .\nRUN ${SECRET_MOUNT} bun install --frozen-lockfile`,
    );
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([
      expect.stringContaining("still declared as ARG/ENV"),
    ]);
  });

  test("secret mount next to an ARG of the variable bunfig reads is a violation", () => {
    const text = dockerfile(
      `ARG GITHUB_TOKEN\nCOPY . .\nRUN ${SECRET_MOUNT} bun install --frozen-lockfile`,
    );
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([
      expect.stringContaining("still declared as ARG/ENV"),
    ]);
  });

  test("without private deps only the token ARG warning and index.html apply", () => {
    const findings = inspectAppDockerfile(
      input({
        dockerfileText: LEGACY_DOCKERFILE,
        hasPrivateScopeDependency: false,
        bunfigText: undefined,
        hasIndexHtml: false,
      }),
    );
    expect(findings.violations).toEqual(["neither public/index.html nor index.html exists"]);
    expect(findings.warnings).toHaveLength(1);
    const publicApp = input({
      dockerfileText: dockerfile("COPY . .\nRUN bun install --frozen-lockfile"),
      hasPrivateScopeDependency: false,
      bunfigText: undefined,
    });
    expect(inspectAppDockerfile(publicApp)).toEqual({ violations: [], warnings: [] });
  });

  test("bunfig scope present but not copied before the install is a violation", () => {
    const text = dockerfile(
      `COPY package.json bun.lock ./\nRUN ${SECRET_MOUNT} bun install --frozen-lockfile\nCOPY . .`,
    );
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([
      expect.stringContaining("no registry auth"),
    ]);
  });

  test(".npmrc with registry line and _authToken is an accepted auth path", () => {
    const text = dockerfile(`COPY . .\nRUN ${SECRET_MOUNT} bun install --frozen-lockfile`);
    const findings = inspectAppDockerfile(
      input({ dockerfileText: text, bunfigText: undefined, npmrcText: NPMRC }),
    );
    expect(findings.violations).toEqual([]);
    const withoutToken = inspectAppDockerfile(
      input({
        dockerfileText: text,
        bunfigText: undefined,
        npmrcText: "@cosmicdriftgamestudio:registry=https://npm.pkg.github.com\n",
      }),
    );
    expect(withoutToken.violations).toContainEqual(expect.stringContaining("no registry auth"));
  });

  test("private deps without any full install stage is a violation", () => {
    const text = "FROM oven/bun:1.4.4-alpine\nRUN bun install --production";
    expect(inspectAppDockerfile(input({ dockerfileText: text })).violations).toEqual([
      expect.stringContaining("no stage runs a `bun install` without --production"),
    ]);
  });
});

describe("app-dockerfile check over a repo", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function write(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }

  function makeApp(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "app-dockerfile-"));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) write(join(dir, rel), content);
    return fixtureRoot("app", dir, { kind: "app", sourceRoots: ["src"], testGlobs: [] });
  }

  test("reads package.json, bunfig.toml and index.html from disk", async () => {
    const root = makeApp({
      "package.json": JSON.stringify({
        name: "app",
        devDependencies: { "@cosmicdriftgamestudio/kumiko-ai-foundation": "0.69.0" },
      }),
      "bunfig.toml": BUNFIG,
      "public/index.html": "<!doctype html>",
      "deploy/Dockerfile": dockerfile("COPY . .\nRUN bun install --frozen-lockfile"),
    });
    const outcome = await check.run([root]);
    expect(outcome.matchedFiles).toBe(1);
    expect(outcome.violations.map((violation) => violation.message)).toEqual([
      expect.stringContaining("does not mount the registry token"),
    ]);
  });

  test("repo without deploy/Dockerfile is not applicable", async () => {
    const root = makeApp({ "package.json": JSON.stringify({ name: "lib" }) });
    const outcome = await check.run([root]);
    expect(outcome.notApplicable).toBe(true);
  });
});
