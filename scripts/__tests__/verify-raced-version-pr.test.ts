import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "bun:test";

// publish-raced-version-pr.sh's verification (does head_sha really carry the
// same versions as $GITHUB_SHA?) must never publish an unverified tree. This
// drives the actual script — not a re-implementation — against a real, throwaway
// git repo, so a behavioural regression in the verification logic is caught.

const SCRIPT_PATH = fileURLToPath(new URL("../verify-raced-version-pr.sh", import.meta.url));

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: GIT_ENV, stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function writeFile(dir: string, relPath: string, content: string) {
  const fullPath = join(dir, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function verify(cwd: string, headSha: string, targetSha: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync(["bash", SCRIPT_PATH, headSha, targetSha], {
    cwd,
    env: GIT_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode ?? -1, output: result.stdout.toString().trim() };
}

// Builds: A (base) -> version-branch commit V (bumps version.txt); main gets
// C (adds a real changeset) on top of A; landed = V rebased onto C via
// cherry-pick, same patch as V but a different SHA and a different parent.
function buildFixture(): { repo: string; a: string; v: string; c: string; landed: string } {
  const repo = mkdtempSync(join(tmpdir(), "verify-raced-version-pr-"));
  tempDirs.push(repo);
  git(repo, ["init", "-q", "-b", "main", "."]);
  writeFile(repo, "version.txt", "0.1.0\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "A"]);
  const a = git(repo, ["rev-parse", "HEAD"]);

  git(repo, ["checkout", "-q", "-b", "version-branch"]);
  writeFile(repo, "version.txt", "0.2.0\n");
  git(repo, ["commit", "-q", "-am", "bump version"]);
  const v = git(repo, ["rev-parse", "HEAD"]);

  git(repo, ["checkout", "-q", "main"]);
  writeFile(repo, ".changeset/x.md", '---\n"pkg": patch\n---\nx\n');
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "add changeset"]);
  const c = git(repo, ["rev-parse", "HEAD"]);

  git(repo, ["checkout", "-q", "-b", "landed", c]);
  git(repo, ["cherry-pick", v]);
  const landed = git(repo, ["rev-parse", "HEAD"]);

  return { repo, a, v, c, landed };
}

describe("verify-raced-version-pr.sh", () => {
  test("accepts a version-PR head rebased/squash-merged onto a later main", () => {
    const { repo, v, landed } = buildFixture();
    const result = verify(repo, v, landed);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("ok");
  });

  test("rejects a head whose patch differs from the target (tampered)", () => {
    const { repo, v, c } = buildFixture();
    git(repo, ["checkout", "-q", "-b", "tampered", c]);
    git(repo, ["cherry-pick", "--no-commit", v]);
    writeFile(repo, "version.txt", "0.9.9-tampered\n");
    git(repo, ["commit", "-q", "-am", "bump version (tampered)"]);
    const tampered = git(repo, ["rev-parse", "HEAD"]);

    const result = verify(repo, v, tampered);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("patch-id mismatch");
  });

  test("rejects a head whose parent is not an ancestor of the target", () => {
    const { repo, v } = buildFixture();
    git(repo, ["checkout", "-q", "--orphan", "unrelated"]);
    git(repo, ["rm", "-rf", "-q", "."]);
    writeFile(repo, "u.txt", "unrelated\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "unrelated"]);
    const unrelated = git(repo, ["rev-parse", "HEAD"]);

    const result = verify(repo, v, unrelated);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("not an ancestor");
  });

  test("rejects a head whose tree still carries a pending changeset", () => {
    const { repo, a, c } = buildFixture();
    git(repo, ["checkout", "-q", a]);
    git(repo, ["checkout", "-q", "-b", "version-branch-pending"]);
    writeFile(repo, "version.txt", "0.2.0\n");
    writeFile(repo, ".changeset/y.md", '---\n"pkg": patch\n---\ny\n');
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "bump version + pending changeset"]);
    const vPending = git(repo, ["rev-parse", "HEAD"]);

    git(repo, ["checkout", "-q", "-b", "landed-pending", c]);
    git(repo, ["cherry-pick", vPending]);
    const targetPending = git(repo, ["rev-parse", "HEAD"]);

    const result = verify(repo, vPending, targetPending);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("pending changesets");
  });
});
