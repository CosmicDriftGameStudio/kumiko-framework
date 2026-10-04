import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "bun:test";

const SCRIPT_PATH = fileURLToPath(new URL("../verify-version-pr-fresh.sh", import.meta.url));

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
  if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function writeFile(dir: string, relPath: string, content: string) {
  const fullPath = join(dir, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function commitAll(repo: string, message: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function verify(cwd: string, headSha: string, mainSha: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync(["bash", SCRIPT_PATH, headSha, mainSha], {
    cwd,
    env: GIT_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode ?? -1, output: result.stdout.toString().trim() };
}

const CHANGESET = '---\n"pkg": patch\n---\nx\n';

// main carries changeset x.md; the bot's version commit sits on top of it and
// deletes it, which is the shape of a fresh Version PR.
function buildFreshVersionPr(): { repo: string; main: string; versionHead: string } {
  const repo = mkdtempSync(join(tmpdir(), "verify-version-pr-fresh-"));
  tempDirs.push(repo);
  git(repo, ["init", "-q", "-b", "main", "."]);
  writeFile(repo, "version.txt", "0.1.0\n");
  writeFile(repo, ".changeset/README.md", "readme\n");
  writeFile(repo, ".changeset/x.md", CHANGESET);
  const main = commitAll(repo, "main with changeset x");

  git(repo, ["checkout", "-q", "-b", "changeset-release/main"]);
  writeFile(repo, "version.txt", "0.2.0\n");
  git(repo, ["rm", "-q", ".changeset/x.md"]);
  const versionHead = commitAll(repo, "chore: version packages");
  git(repo, ["checkout", "-q", "main"]);
  return { repo, main, versionHead };
}

describe("verify-version-pr-fresh.sh", () => {
  test("accepts a Version PR built on main HEAD that consumed every changeset", () => {
    const { repo, main, versionHead } = buildFreshVersionPr();
    expect(verify(repo, versionHead, main)).toEqual({ exitCode: 0, output: "ok" });
  });

  test("rejects a Version PR whose base is behind main HEAD", () => {
    const { repo, versionHead } = buildFreshVersionPr();
    writeFile(repo, "other.txt", "later commit\n");
    const newerMain = commitAll(repo, "later main commit");

    const result = verify(repo, versionHead, newerMain);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("not based on the current main HEAD");
  });

  test("rejects a Version PR built on main HEAD that left a changeset unconsumed", () => {
    const { repo, main } = buildFreshVersionPr();
    git(repo, ["checkout", "-q", "-b", "partial", main]);
    writeFile(repo, "version.txt", "0.2.0\n");
    const partialHead = commitAll(repo, "version without consuming x.md");
    git(repo, ["checkout", "-q", "main"]);

    const result = verify(repo, partialHead, main);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(".changeset/x.md");
  });

  test("ignores the changeset README", () => {
    const { repo, main, versionHead } = buildFreshVersionPr();
    expect(git(repo, ["ls-tree", "-r", "--name-only", versionHead, "--", ".changeset"])).toBe(
      ".changeset/README.md",
    );
    expect(verify(repo, versionHead, main).exitCode).toBe(0);
  });
});
