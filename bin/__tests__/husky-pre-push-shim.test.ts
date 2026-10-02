import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv, runGit } from "../_git-test-helpers";

const SHIM_PATH = join(import.meta.dir, "..", "..", ".husky", "pre-push");

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function writeExecutable(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function runShim(repoRoot: string): { status: number | null; stdout: string } {
  const result = Bun.spawnSync(["sh", join(repoRoot, ".husky", "pre-push")], {
    cwd: repoRoot,
    env: cleanGitEnv() as Record<string, string>,
  });
  return { status: result.exitCode, stdout: result.stdout.toString().trim() };
}

function makeRepoWithShim(): string {
  const parent = mkdtempSync(join(tmpdir(), "kumiko-husky-shim-"));
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const repo = join(parent, "repo");
  mkdirSync(join(repo, ".husky"), { recursive: true });
  copyFileSync(SHIM_PATH, join(repo, ".husky", "pre-push"));
  runGit(["init", "-q"], repo);
  return repo;
}

describe(".husky/pre-push shim", () => {
  test("prefers the checked-out packages/guards hook over the node_modules/.bin install", () => {
    const repo = makeRepoWithShim();
    writeExecutable(join(repo, "packages", "guards", "src", "pre-push.sh"), "#!/bin/sh\necho in-repo\n");
    writeExecutable(join(repo, "node_modules", ".bin", "kumiko-pre-push"), "#!/bin/sh\necho installed\n");

    expect(runShim(repo)).toEqual({ status: 0, stdout: "in-repo" });
  });

  test("falls back to node_modules/.bin when the repo does not ship the hook", () => {
    const repo = makeRepoWithShim();
    writeExecutable(join(repo, "node_modules", ".bin", "kumiko-pre-push"), "#!/bin/sh\necho installed\n");

    expect(runShim(repo)).toEqual({ status: 0, stdout: "installed" });
  });
});
