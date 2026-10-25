import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_CHECKS, type RepoRoot } from "@cosmicdrift/kumiko-guards";
import { scaffoldDeploy } from "../scaffold-deploy.ts";

const appDockerfileCheck = REPO_CHECKS.find((check) => check.name === "app-dockerfile");

function appRoot(absPath: string): RepoRoot {
  return {
    name: "ghapp",
    absPath,
    kind: "app",
    manifest: { kind: "app", sourceRoots: ["src"], testGlobs: [] },
    manifestSource: "file",
  };
}

describe("scaffolded Dockerfile passes the app-dockerfile check", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "scaffold-deploy-guard-"));
    mkdirSync(join(tmp, "public"));
    writeFileSync(join(tmp, "public", "index.html"), "<!doctype html>");
    writeFileSync(
      join(tmp, "bunfig.toml"),
      '[install.scopes]\n"@cosmicdriftgamestudio" = { url = "https://npm.pkg.github.com", token = "$GITHUB_TOKEN" }\n',
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  for (const [variant, extraDependencies] of [
    ["manifests-first install", {}],
    ["full-tree install", { "local-kit": "file:./packages/kit" }],
  ] as const) {
    it(`${variant} with private deps: no violation, no warning`, async () => {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({
          name: "ghapp",
          dependencies: {
            "@cosmicdriftgamestudio/kumiko-ai-foundation": "^0.2.0",
            ...extraDependencies,
          },
        }),
      );
      scaffoldDeploy({ appName: "ghapp", destination: tmp });
      const outcome = await appDockerfileCheck?.run([appRoot(tmp)]);
      expect(outcome?.matchedFiles).toBe(1);
      expect(outcome?.violations).toEqual([]);
      expect(outcome?.warnings).toEqual([]);
    });
  }
});
