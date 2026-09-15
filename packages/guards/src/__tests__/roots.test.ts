import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findLocalRepo, frameworkPackageTsConfigPath } from "../_lib/roots";
import { writeRepo } from "./parent-workspace-fixture";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "kumiko-roots-"));
}

/** Bare package.json only — no manifest, no repo marker. Used to test the negative/gate paths. */
function writePkg(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }), "utf-8");
}

describe("findLocalRepo — derived 'app' layout counts only as a fallback (infra#499)", () => {
  test("an unregistered repo with a flat src/ layout resolves via the derived app fallback", () => {
    const ws = workspace();
    const clone = join(ws, "brand-new-app");
    writeRepo(clone, { name: "brand-new-app", layout: "flat" });

    const local = findLocalRepo(clone);

    expect(local?.kind).toBe("app");
    expect(local?.manifestSource).toBe("derived");
    expect(local?.name).toBe("brand-new-app");
    expect(local?.absPath).toBe(clone);
    rmSync(ws, { recursive: true, force: true });
  });

  test("unregistered multi-package repo: packages/foo/src resolves to repo root, not the package", () => {
    const ws = workspace();
    const repo = join(ws, "offlot-web");
    writeRepo(repo, { name: "offlot-web", layout: "flat" });
    const nested = join(repo, "packages", "foo");
    writePkg(nested, "@offlot/foo");
    mkdirSync(join(nested, "src"), { recursive: true });

    const local = findLocalRepo(nested);

    expect(local?.absPath).toBe(repo);
    expect(local?.name).toBe("offlot-web");
    // packages/foo/src derives layout "library" (preferred over a flat src/) — what matters here is the nested package never claims to be its own repo root.
    expect(local?.manifestSource).toBe("derived");
    expect(local?.kind).toBe("library");
    rmSync(ws, { recursive: true, force: true });
  });

  test("an unregistered repo without a src/ dir or kumiko.json stays undefined — the layout gate still gates", () => {
    const ws = workspace();
    const clone = join(ws, "brand-new-app");
    writePkg(clone, "brand-new-app");

    expect(findLocalRepo(clone)).toBeUndefined();
    rmSync(ws, { recursive: true, force: true });
  });

  test("a nested derived-app package defers to an outer repo with an explicit kumiko.json, even when both are kind 'app'", () => {
    const ws = workspace();
    const repo = join(ws, "kumiko-studio");
    writeRepo(repo, {
      name: "kumiko-studio",
      layout: { manifest: { kind: "app", sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] } },
    });
    const nested = join(repo, "packages", "widget-demo");
    writePkg(nested, "widget-demo");
    writeFileSync(join(nested, "bun.lock"), "{}", "utf-8");
    mkdirSync(join(nested, "src"), { recursive: true });

    const local = findLocalRepo(nested);

    expect(local?.absPath).toBe(repo);
    expect(local?.manifestSource).toBe("file");
    rmSync(ws, { recursive: true, force: true });
  });

  test("an unregistered nested package inside a repo with its own kumiko.json does not shadow the repo's manifest", () => {
    const ws = workspace();
    const repo = join(ws, "kumiko-framework");
    writeRepo(repo, {
      name: "kumiko-framework",
      layout: {
        manifest: {
          kind: "framework",
          sourceRoots: ["packages/*/src"],
          testGlobs: ["packages/*/src/**/*.test.ts"],
        },
      },
    });
    const nestedApp = join(repo, "samples", "apps", "cap-billing-demo");
    writePkg(nestedApp, "cap-billing-demo");
    mkdirSync(join(nestedApp, "src"), { recursive: true });

    const local = findLocalRepo(nestedApp);

    expect(local?.kind).toBe("framework");
    expect(local?.name).toBe("kumiko-framework");
    expect(local?.absPath).toBe(repo);
    rmSync(ws, { recursive: true, force: true });
  });

  test("findLocalRepo resolves the repo from a nested dir with no .git (package.json-walk fallback)", () => {
    const ws = workspace();
    const worktree = join(ws, "kumiko-framework-fix");
    writeRepo(worktree, { name: "kumiko-framework", layout: "packages" });
    const nested = join(worktree, "packages", "framework", "src");
    mkdirSync(nested, { recursive: true });

    expect(findLocalRepo(nested)?.absPath).toBe(worktree);
    expect(findLocalRepo(nested)?.name).toBe("kumiko-framework");
    rmSync(ws, { recursive: true, force: true });
  });
});

describe("frameworkPackageTsConfigPath — standalone unregistered app repo does not crash (infra#499)", () => {
  test("falls back to the local repo's own tsconfig.json instead of throwing when no packages/<pkg>/tsconfig.json exists", () => {
    const ws = workspace();
    const clone = join(ws, "brand-new-app");
    writeRepo(clone, { name: "brand-new-app", layout: "flat" });
    writeFileSync(join(clone, "tsconfig.json"), "{}", "utf-8");

    const tsConfigPath = frameworkPackageTsConfigPath("framework", clone);

    expect(tsConfigPath?.endsWith("brand-new-app/tsconfig.json")).toBe(true);
    rmSync(ws, { recursive: true, force: true });
  });

  test("returns undefined when the unregistered repo has no local tsconfig.json to fall back to", () => {
    const ws = workspace();
    const clone = join(ws, "brand-new-app");
    writeRepo(clone, { name: "brand-new-app", layout: "flat" });

    expect(frameworkPackageTsConfigPath("framework", clone)).toBeUndefined();
    rmSync(ws, { recursive: true, force: true });
  });
});

describe("resolveRepoRoots — real git worktree integration", () => {
  test("a git worktree resolves to its own path via findLocalRepo, not the canonical checkout", () => {
    const ws = workspace();
    const canonical = join(ws, "brand-new-app");
    writeRepo(canonical, { name: "brand-new-app", layout: "flat" });
    // Allowlist only, not `...process.env` — a leaked GIT_DIR/GIT_WORK_TREE
    // from an ambient git hook survives into spawned git subprocesses and
    // overrides `cwd`/`-C`, hijacking the real repo instead of this fixture.
    // GIT_CEILING_DIRECTORIES stops repo discovery from climbing past the
    // workspace root even if init misbehaves.
    const env: Record<string, string> = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CEILING_DIRECTORIES: ws,
    };
    for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME"] as const) {
      const v = process.env[key];
      if (v !== undefined) env[key] = v;
    }
    const git = (args: string[]) => Bun.spawnSync(["git", "-C", canonical, ...args], { env });
    expect(git(["init", "-q", "-b", "main"]).success).toBe(true);
    git(["config", "user.email", "t@e.com"]);
    git(["config", "user.name", "t"]);
    // Hard guardrail: refuse to commit unless git actually resolved the
    // fixture, not a repo hijacked via a leaked GIT_DIR/GIT_WORK_TREE.
    const toplevel = git(["rev-parse", "--show-toplevel"]).stdout.toString().trim();
    expect(realpathSync(toplevel)).toBe(realpathSync(canonical));
    expect(git(["add", "-A"]).success).toBe(true);
    expect(git(["commit", "-q", "-m", "init"]).success).toBe(true);
    const wt = join(ws, "brand-new-app-wt");
    expect(git(["worktree", "add", "-q", "-b", "feature", wt]).success).toBe(true);
    expect(findLocalRepo(wt)?.absPath).toBe(wt);
    rmSync(ws, { recursive: true, force: true });
  });
});
