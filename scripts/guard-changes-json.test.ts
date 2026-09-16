import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "../packages/guards/src/_lib/git-env";
import { findChangelogViolations, findChangesetViolations, isReleaseBranch } from "./guard-changes-json";

// Fixture git spawns get gitEnv() (never inherited GIT_DIR/GIT_WORK_TREE) plus
// GIT_CEILING_DIRECTORIES/GIT_CONFIG_GLOBAL pinned to the fixture tree, so a
// run triggered by this very repo's pre-push hook can never touch the real
// repo even if a fixture command itself is spawned with a leaked env — see #2951.
function fixtureGitEnv(ceilingDir: string): Record<string, string> {
  return {
    ...gitEnv(),
    GIT_CEILING_DIRECTORIES: ceilingDir,
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function buildFixtureRoot(features: readonly [relDir: string, entries: unknown][]): string {
  const root = mkdtempSync(join(tmpdir(), "changes-json-"));
  for (const [relDir, entries] of features) {
    const dir = join(root, "packages", relDir, "src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "changes.json"), JSON.stringify(entries, null, 2));
  }
  return root;
}

describe("findChangelogViolations", () => {
  it("passes a clean fixture: descending order, breaking with migration", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          {
            version: "0.2.0",
            type: "breaking",
            title: "removed the old thing",
            migration: "use the new thing instead",
          },
          { version: "0.1.0", type: "improvement", title: "added the old thing" },
        ],
      ],
    ]);

    expect(findChangelogViolations(root, [])).toEqual([]);
  });

  it("flags entries that are not newest-version-first", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.1.0", type: "fix", title: "first" },
          { version: "0.2.0", type: "fix", title: "second" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root, []);
    expect(violations.length).toBe(1);
    expect(violations[0].detail).toContain("newest-version-first");
  });

  it("allows equal versions back to back", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.1.0", type: "fix", title: "first" },
          { version: "0.1.0", type: "improvement", title: "second" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root, []);
    expect(violations.some((v) => v.detail.includes("newest-version-first"))).toBe(false);
  });

  it("flags an entry silently dropped by parseFeatureChangelog for an invalid type", () => {
    const root = buildFixtureRoot([
      ["some-feature", [{ version: "0.1.0", type: "breakign", title: "typo type" }]],
    ]);

    const violations = findChangelogViolations(root, []);
    expect(violations.some((v) => v.detail.includes("silently dropped"))).toBe(true);
  });

  it("pins the dropped entry's index in a file that also has valid entries", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.3.0", type: "fix", title: "valid newest" },
          { version: "0.2.0", type: "brokn", title: "invalid type in the middle" },
          { version: "0.1.0", type: "improvement", title: "valid oldest" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root, []);
    const droppedViolations = violations.filter((v) => v.detail.includes("silently dropped"));
    expect(droppedViolations.length).toBe(1);
    expect(droppedViolations[0].detail).toContain("entry #1");
    expect(violations.some((v) => v.detail.includes("newest-version-first"))).toBe(false);
  });

  it("flags a breaking entry missing migration", () => {
    const root = buildFixtureRoot([
      ["some-feature", [{ version: "0.1.0", type: "breaking", title: "no migration field" }]],
    ]);

    const violations = findChangelogViolations(root, []);
    expect(violations.some((v) => v.detail.includes("migration"))).toBe(true);
  });

  it("flags a non-semver version and skips the sort check for that file", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.1", type: "fix", title: "not semver" },
          { version: "0.2.0", type: "fix", title: "valid semver but out of order" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root, []);
    expect(violations.some((v) => v.detail.includes("semver"))).toBe(true);
    expect(violations.some((v) => v.detail.includes("newest-version-first"))).toBe(false);
  });

  it("flags invalid JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "changes-json-"));
    const dir = join(root, "packages", "some-feature", "src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "changes.json"), "{ not json");

    const violations = findChangelogViolations(root, []);
    expect(violations.some((v) => v.detail.includes("invalid JSON"))).toBe(true);
  });

  it("flags a repo with no changes.json at all", () => {
    const root = mkdtempSync(join(tmpdir(), "changes-json-"));

    const violations = findChangelogViolations(root, []);
    expect(violations.length).toBe(1);
    expect(violations[0].detail).toContain("no changes.json found");
  });

  it("passes the real repo", () => {
    expect(findChangelogViolations(join(import.meta.dir, ".."), [])).toEqual([]);
  });
});

describe("findChangesetViolations", () => {
  it("requires metadata on changed changesets", () => {
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-"));
    mkdirSync(join(root, ".changeset"), { recursive: true });
    writeFileSync(join(root, ".changeset", "missing.md"), "---\n\"pkg\": patch\n---\n\nPlain note.\n");

    const violations = findChangesetViolations(root, [".changeset/missing.md"]);

    expect(violations).toEqual([
      { file: ".changeset/missing.md", detail: "missing kumiko-changes metadata block" },
    ]);
  });

  it("rejects direct changes.json edits outside the release branch", () => {
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-"));
    mkdirSync(join(root, ".changeset"), { recursive: true });

    const violations = findChangesetViolations(root, ["packages/framework/src/changes.json"], {});

    expect(violations).toEqual([
      {
        file: "packages/framework/src/changes.json",
        detail: "direct changes.json edits are forbidden; add structured metadata to a Changeset instead",
      },
    ]);
  });

  it("allows direct changes.json edits on a release push branch", () => {
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-"));
    mkdirSync(join(root, ".changeset"), { recursive: true });

    expect(isReleaseBranch({ GITHUB_REF_NAME: "changeset-release/main" })).toBe(true);
    expect(findChangesetViolations(root, ["packages/framework/src/changes.json"], {
      GITHUB_REF_NAME: "changeset-release/main",
    })).toEqual([]);
  });

  it("ignores deleted changesets", () => {
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-"));
    mkdirSync(join(root, ".changeset"), { recursive: true });

    expect(findChangesetViolations(root, [".changeset/deleted.md"], {})).toEqual([]);
  });

  it("reports a git diff failure instead of passing silently", () => {
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-"));
    mkdirSync(join(root, ".changeset"), { recursive: true });

    const violations = findChangesetViolations(root, undefined, { GITHUB_BASE_SHA: "missing-base" });
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("git");
  });

  it("uses main as the push base when GITHUB_BASE_REF is empty", () => {
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-git-"));
    const remote = join(root, "remote.git");
    const repo = join(root, "repo");

    const runGit = (args: string[], cwd: string): void => {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env: fixtureGitEnv(root),
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        throw new Error(`${args.join(" ")}: ${result.stderr.toString()}`);
      }
    };

    try {
      mkdirSync(repo, { recursive: true });
      runGit(["init", "--bare", remote], root);
      runGit(["init", "-q", repo], root);
      runGit(["config", "user.email", "test@example.com"], repo);
      runGit(["config", "user.name", "test"], repo);
      writeFileSync(join(repo, "README.md"), "base\n");
      runGit(["add", "README.md"], repo);
      runGit(["commit", "-q", "-m", "base"], repo);
      runGit(["branch", "-M", "main"], repo);
      runGit(["remote", "add", "origin", remote], repo);
      runGit(["push", "-q", "-u", "origin", "main"], repo);
      runGit(["switch", "-q", "-c", "feature"], repo);
      mkdirSync(join(repo, ".changeset"));
      writeFileSync(join(repo, ".changeset", "missing.md"), "Plain note.\n");
      runGit(["add", ".changeset/missing.md"], repo);
      runGit(["commit", "-q", "-m", "changeset"], repo);

      const violations = findChangesetViolations(repo, undefined, {
        GITHUB_BASE_REF: "",
        GITHUB_EVENT_NAME: "push",
      });

      expect(violations).toEqual([
        { file: ".changeset/missing.md", detail: "missing kumiko-changes metadata block" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not leak GIT_DIR/GIT_WORK_TREE into a parent repo (regression #2951)", () => {
    // In-process `process.env.GIT_DIR = …` mutation does NOT reach
    // Bun.spawnSync's default (omitted-env) inheritance — verified: Bun
    // snapshots the real OS environ at process start, not the live JS
    // `process.env` object, for that path. A real Husky pre-push hook sets
    // GIT_DIR/GIT_WORK_TREE in its actual OS environ and then execs
    // `bun run …`, which genuinely inherits it. So this test spawns a real
    // child `bun` process with GIT_DIR/GIT_WORK_TREE in ITS environment —
    // that process then calls `findChangesetViolations` and every git spawn
    // nested inside it inherits the leak exactly like the real incident did.
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-leak-"));
    const remote = join(root, "remote.git");
    const repo = join(root, "repo");
    const parent = join(root, "parent");
    const harnessPath = join(root, "harness.ts");

    const runGit = (args: string[], cwd: string): void => {
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env: fixtureGitEnv(root),
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        throw new Error(`${args.join(" ")}: ${result.stderr.toString()}`);
      }
    };
    const capture = (args: string[], cwd: string): string => {
      const result = Bun.spawnSync(["git", ...args], { cwd, env: fixtureGitEnv(root) });
      return result.stdout.toString().trim();
    };

    try {
      // Target repo: what the guard is told to operate on (repoRoot).
      mkdirSync(repo, { recursive: true });
      runGit(["init", "--bare", remote], root);
      runGit(["init", "-q", repo], root);
      runGit(["config", "user.email", "test@example.com"], repo);
      runGit(["config", "user.name", "test"], repo);
      writeFileSync(join(repo, "README.md"), "base\n");
      runGit(["add", "README.md"], repo);
      runGit(["commit", "-q", "-m", "base"], repo);
      runGit(["branch", "-M", "main"], repo);
      runGit(["remote", "add", "origin", remote], repo);
      runGit(["push", "-q", "-u", "origin", "main"], repo);
      runGit(["switch", "-q", "-c", "feature"], repo);
      mkdirSync(join(repo, ".changeset"));
      writeFileSync(join(repo, ".changeset", "missing.md"), "Plain note.\n");
      runGit(["add", ".changeset/missing.md"], repo);
      runGit(["commit", "-q", "-m", "changeset"], repo);

      // Parent repo: simulates the real, shared checkout a Husky pre-push
      // hook is running in. It shares the same origin, so a leaked fetch
      // would succeed against it (not just fail loudly).
      mkdirSync(parent, { recursive: true });
      runGit(["init", "-q", parent], root);
      runGit(["config", "user.email", "parent@example.com"], parent);
      runGit(["config", "user.name", "parent"], parent);
      writeFileSync(join(parent, "PARENT.md"), "parent\n");
      runGit(["add", "PARENT.md"], parent);
      runGit(["commit", "-q", "-m", "parent initial"], parent);
      runGit(["remote", "add", "origin", remote], parent);

      const parentHeadBefore = capture(["rev-parse", "HEAD"], parent);
      const parentBranchBefore = capture(["rev-parse", "--abbrev-ref", "HEAD"], parent);
      const parentCommitCountBefore = capture(["rev-list", "--count", "HEAD"], parent);
      expect(existsSync(join(parent, ".git", "FETCH_HEAD"))).toBe(false);

      const guardPath = join(import.meta.dir, "guard-changes-json.ts");
      writeFileSync(
        harnessPath,
        [
          `import { findChangesetViolations } from ${JSON.stringify(guardPath)};`,
          `const violations = findChangesetViolations(${JSON.stringify(repo)}, undefined, { GITHUB_BASE_REF: "", GITHUB_EVENT_NAME: "push" });`,
          "console.log(JSON.stringify(violations));",
        ].join("\n"),
      );

      // The Husky pre-push hook's own environment: GIT_DIR/GIT_WORK_TREE
      // point at the PARENT repo, while the guard is told (via its own
      // repoRoot argument, baked into the harness above) to operate on `repo`.
      const hookEnv: Record<string, string> = {
        ...gitEnv(),
        GIT_DIR: join(parent, ".git"),
        GIT_WORK_TREE: parent,
      };
      const harnessResult = Bun.spawnSync(["bun", harnessPath], {
        cwd: repo,
        env: hookEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (harnessResult.exitCode !== 0) {
        throw new Error(`harness failed: ${harnessResult.stderr.toString()}`);
      }
      const violations = JSON.parse(harnessResult.stdout.toString().trim());

      // The guard must still report on `repo`'s own diff, not the parent's.
      expect(violations).toEqual([
        { file: ".changeset/missing.md", detail: "missing kumiko-changes metadata block" },
      ]);

      // The parent repo must be byte-for-byte untouched: no fetch landed
      // there, no branch got renamed, no foreign commit appeared.
      expect(existsSync(join(parent, ".git", "FETCH_HEAD"))).toBe(false);
      expect(capture(["rev-parse", "HEAD"], parent)).toBe(parentHeadBefore);
      expect(capture(["rev-parse", "--abbrev-ref", "HEAD"], parent)).toBe(parentBranchBefore);
      expect(capture(["rev-list", "--count", "HEAD"], parent)).toBe(parentCommitCountBefore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
