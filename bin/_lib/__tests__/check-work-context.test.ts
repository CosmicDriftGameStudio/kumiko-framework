import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runGit } from "../../_git-test-helpers";
import {
  formatCheckWorkContext,
  resolveCheckWorkContext,
  resolveWorkspaceRoot,
} from "../check-work-context";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
  delete process.env["KUMIKO_CLI_SCOPE"];
  delete process.env["KUMIKO_WORKSPACE_ROOT"];
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-check-ctx-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writePkg(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }), "utf-8");
}

describe("check-work-context", () => {
  test("formatCheckWorkContext includes cwd and workspace root", () => {
    const text = formatCheckWorkContext({
      cwd: "/tmp/wt",
      gitWorktree: "/tmp/wt",
      localRepoName: "kumiko-framework",
      localRepoPath: "/tmp/wt",
      cliScope: "kumiko-framework",
      workspaceRoot: "/tmp/cosmicdriftgamestudio",
    });
    expect(text).toContain("cwd:            /tmp/wt");
    expect(text).toContain("git worktree:   /tmp/wt");
    expect(text).toContain("local repo:     kumiko-framework");
    expect(text).toContain("workspace root: /tmp/cosmicdriftgamestudio");
    expect(text).toContain("cli scope:      kumiko-framework");
  });

  test("resolveCheckWorkContext finds local repo by package.json name", () => {
    const root = tempDir();
    const workspace = join(root, "cosmicdriftgamestudio");
    const worktree = join(workspace, "kumiko-framework-dx");
    writePkg(workspace, "cosmicdriftgamestudio");
    writePkg(worktree, "kumiko-framework");

    const ctx = resolveCheckWorkContext(worktree, join(workspace, "kumiko-framework"));
    expect(ctx.localRepoName).toBe("kumiko-framework");
    expect(ctx.localRepoPath).toBe(resolve(worktree));
    expect(ctx.workspaceRoot).toBe(resolve(workspace));
  });

  test("resolveWorkspaceRoot honors KUMIKO_WORKSPACE_ROOT", () => {
    const root = tempDir();
    process.env["KUMIKO_WORKSPACE_ROOT"] = root;
    expect(resolveWorkspaceRoot("/anywhere", "/fallback")).toBe(root);
  });

  test("resolveCheckWorkContext uses git worktree when package.json name is canonical", () => {
    const root = tempDir();
    runGit(["init", "-b", "main"], root);
    runGit(["config", "user.email", "test@test"], root);
    runGit(["config", "user.name", "Test"], root);
    writePkg(root, "kumiko-framework");
    runGit(["add", "package.json"], root);
    runGit(["commit", "-m", "init"], root);
    const nested = join(root, "packages", "framework", "src");
    mkdirSync(nested, { recursive: true });

    const ctx = resolveCheckWorkContext(nested, root);
    const repoRoot = realpathSync(root);
    expect(ctx.gitWorktree).toBe(repoRoot);
    expect(ctx.localRepoPath).toBe(repoRoot);
  });
});
