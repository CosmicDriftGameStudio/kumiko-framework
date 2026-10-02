import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "@cosmicdrift/kumiko-guards";
import { findChangelogViolations, findChangesetViolations, isReleaseBranch } from "./guard-changes-json";

// Fixture git spawns get gitEnv() (never inherited GIT_DIR/GIT_WORK_TREE) plus
// GIT_CEILING_DIRECTORIES/GIT_CONFIG_GLOBAL pinned to the fixture tree, so a
// run triggered by this very repo's pre-push hook can never touch the real
// repo even if a fixture command itself is spawned with a leaked env.
function fixtureGitEnv(ceilingDir: string): Record<string, string> {
  return {
    ...gitEnv(),
    GIT_CEILING_DIRECTORIES: ceilingDir,
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

function buildFixtureRoot(features: readonly [relDir: string, entries: unknown][]): string {
  const root = makeTempRoot("changes-json-");
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
    const root = makeTempRoot("changes-json-");
    const dir = join(root, "packages", "some-feature", "src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "changes.json"), "{ not json");

    const violations = findChangelogViolations(root, []);
    expect(violations.some((v) => v.detail.includes("invalid JSON"))).toBe(true);
  });

  it("flags a repo with no changes.json at all", () => {
    const root = makeTempRoot("changes-json-");

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
    const root = makeTempRoot("changeset-guard-");
    mkdirSync(join(root, ".changeset"), { recursive: true });
    writeFileSync(join(root, ".changeset", "missing.md"), "---\n\"pkg\": patch\n---\n\nPlain note.\n");

    const violations = findChangesetViolations(root, [".changeset/missing.md"]);

    expect(violations).toEqual([
      { file: ".changeset/missing.md", detail: "missing kumiko-changes metadata block" },
    ]);
  });

  it("flags a feature that does not resolve and one missing from the frontmatter", () => {
    const root = makeTempRoot("changeset-guard-");
    mkdirSync(join(root, ".changeset"), { recursive: true });
    mkdirSync(join(root, "packages", "framework"), { recursive: true });
    writeFileSync(
      join(root, "packages", "framework", "package.json"),
      JSON.stringify({ name: "@cosmicdrift/kumiko-framework" }),
    );
    const block = (feature: string): string =>
      `<!-- kumiko-changes\nfeature: ${feature}\ntype: fix\ntitle: Fix it\n-->\n`;
    writeFileSync(
      join(root, ".changeset", "typo.md"),
      `---\n"@cosmicdrift/kumiko-framework": patch\n---\n\nFix it\n\n${block("framwork")}`,
    );
    writeFileSync(
      join(root, ".changeset", "other-package.md"),
      `---\n"@cosmicdrift/kumiko-guards": patch\n---\n\nFix it\n\n${block("framework")}`,
    );
    writeFileSync(
      join(root, ".changeset", "ok.md"),
      `---\n"@cosmicdrift/kumiko-framework": patch\n---\n\nFix it\n\n${block("framework")}`,
    );

    const violations = findChangesetViolations(
      root,
      [".changeset/typo.md", ".changeset/other-package.md", ".changeset/ok.md"],
      {},
    );

    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({ file: ".changeset/typo.md", detail: 'unknown feature "framwork"' });
    expect(violations[1]?.file).toBe(".changeset/other-package.md");
    expect(violations[1]?.detail).toContain("missing from the changeset frontmatter");
  });

  it("rejects direct changes.json edits outside the release branch", () => {
    const root = makeTempRoot("changeset-guard-");
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
    const root = makeTempRoot("changeset-guard-");
    mkdirSync(join(root, ".changeset"), { recursive: true });

    expect(isReleaseBranch({ GITHUB_REF_NAME: "changeset-release/main" })).toBe(true);
    expect(findChangesetViolations(root, ["packages/framework/src/changes.json"], {
      GITHUB_REF_NAME: "changeset-release/main",
    })).toEqual([]);
  });

  it("ignores deleted changesets", () => {
    const root = makeTempRoot("changeset-guard-");
    mkdirSync(join(root, ".changeset"), { recursive: true });

    expect(findChangesetViolations(root, [".changeset/deleted.md"], {})).toEqual([]);
  });

  it("reports a git diff failure instead of passing silently", () => {
    const root = makeTempRoot("changeset-guard-");
    mkdirSync(join(root, ".changeset"), { recursive: true });

    const violations = findChangesetViolations(root, undefined, { GITHUB_BASE_SHA: "missing-base" });
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("git");
  });

  it("uses main as the push base when GITHUB_BASE_REF is empty", () => {
    const root = makeTempRoot("changeset-guard-git-");
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

  describe("diff base", () => {
    function makeRepo(): { root: string; repo: string; git: (args: string[], cwd?: string) => string } {
      const root = makeTempRoot("changeset-guard-base-");
      const remote = join(root, "remote.git");
      const repo = join(root, "repo");
      const git = (args: string[], cwd: string = repo): string => {
        const result = Bun.spawnSync(["git", ...args], {
          cwd,
          env: fixtureGitEnv(root),
          stdout: "pipe",
          stderr: "pipe",
        });
        if (result.exitCode !== 0) throw new Error(`${args.join(" ")}: ${result.stderr.toString()}`);
        return result.stdout.toString().trim();
      };
      mkdirSync(repo, { recursive: true });
      git(["init", "--bare", remote], root);
      git(["init", "-q", repo], root);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "test"]);
      writeFileSync(join(repo, "README.md"), "base\n");
      git(["add", "README.md"]);
      git(["commit", "-q", "-m", "base"]);
      git(["branch", "-M", "main"]);
      git(["remote", "add", "origin", remote]);
      git(["push", "-q", "-u", "origin", "main"]);
      return { root, repo, git };
    }

    function commitChangesJson(repo: string, git: (args: string[]) => string, message: string): void {
      mkdirSync(join(repo, "packages", "x"), { recursive: true });
      writeFileSync(join(repo, "packages", "x", "changes.json"), `${JSON.stringify(message)}\n`);
      git(["add", "packages/x/changes.json"]);
      git(["commit", "-q", "-m", message]);
    }

    function commitPlainChangeset(repo: string, git: (args: string[]) => string): void {
      mkdirSync(join(repo, ".changeset"), { recursive: true });
      writeFileSync(join(repo, ".changeset", "plain.md"), '---\n"pkg": patch\n---\n\nPlain note.\n');
      git(["add", ".changeset/plain.md"]);
      git(["commit", "-q", "-m", "changeset"]);
    }

    it("ignores files changed on main after the branch point (merge-base diff)", () => {
      const { root, repo, git } = makeRepo();
      try {
        commitChangesJson(repo, git, "initial");
        git(["push", "-q", "origin", "main"]);
        git(["switch", "-q", "-c", "feature"]);
        writeFileSync(join(repo, "feature.txt"), "f\n");
        git(["add", "feature.txt"]);
        git(["commit", "-q", "-m", "feature"]);
        git(["switch", "-q", "main"]);
        commitChangesJson(repo, git, "release commit on main");
        git(["push", "-q", "origin", "main"]);
        git(["switch", "-q", "feature"]);

        const violations = findChangesetViolations(repo, undefined, {
          GITHUB_BASE_REF: "main",
          GITHUB_EVENT_NAME: "pull_request",
        });
        expect(violations).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("still flags a changes.json edit made on the branch", () => {
      const { root, repo, git } = makeRepo();
      try {
        git(["switch", "-q", "-c", "feature"]);
        commitChangesJson(repo, git, "direct edit");

        const violations = findChangesetViolations(repo, undefined, {
          GITHUB_BASE_REF: "main",
          GITHUB_EVENT_NAME: "pull_request",
        });
        expect(violations.map((v) => v.file)).toEqual(["packages/x/changes.json"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("diffs a push to main against the before SHA instead of an empty FETCH_HEAD", () => {
      const { root, repo, git } = makeRepo();
      try {
        const before = git(["rev-parse", "HEAD"]);
        commitPlainChangeset(repo, git);
        git(["push", "-q", "origin", "main"]);

        const violations = findChangesetViolations(repo, undefined, {
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_BEFORE: before,
        });
        expect(violations.map((v) => v.file)).toEqual([".changeset/plain.md"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("does not flag changes.json written by a release merge in a push range", () => {
      const { root, repo, git } = makeRepo();
      try {
        const before = git(["rev-parse", "HEAD"]);
        commitChangesJson(repo, git, "release commit");
        git(["push", "-q", "origin", "main"]);

        const violations = findChangesetViolations(repo, undefined, {
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_BEFORE: before,
        });
        expect(violations).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("falls back to origin/main when GITHUB_BASE_SHA and GITHUB_BASE_REF are empty strings", () => {
      const { root, repo, git } = makeRepo();
      try {
        git(["switch", "-q", "-c", "feature"]);
        commitPlainChangeset(repo, git);

        const violations = findChangesetViolations(repo, undefined, {
          GITHUB_BASE_SHA: "",
          GITHUB_BASE_REF: "",
          GITHUB_EVENT_NAME: "workflow_dispatch",
        });
        expect(violations.map((v) => v.file)).toEqual([".changeset/plain.md"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("does not pass a non-SHA GITHUB_BASE_SHA to git", () => {
      const { root, repo } = makeRepo();
      try {
        const violations = findChangesetViolations(repo, undefined, { GITHUB_BASE_SHA: "--output=x" });
        expect(violations).toEqual([{ file: "git", detail: "GITHUB_BASE_SHA is not a valid commit SHA" }]);
        expect(existsSync(join(repo, "x"))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("ignores a non-SHA GITHUB_EVENT_BEFORE and falls back like the all-zero SHA", () => {
      const { root, repo, git } = makeRepo();
      try {
        git(["switch", "-q", "-c", "feature"]);
        commitPlainChangeset(repo, git);

        const violations = findChangesetViolations(repo, undefined, {
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_BEFORE: "--output=x",
        });
        expect(violations.map((v) => v.file)).toEqual([".changeset/plain.md"]);
        expect(existsSync(join(repo, "x"))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("falls back to main for the all-zero before SHA of a new branch", () => {
      const { root, repo, git } = makeRepo();
      try {
        git(["switch", "-q", "-c", "feature"]);
        commitPlainChangeset(repo, git);

        const violations = findChangesetViolations(repo, undefined, {
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_BEFORE: "0".repeat(40),
        });
        expect(violations.map((v) => v.file)).toEqual([".changeset/plain.md"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  it("does not leak GIT_DIR/GIT_WORK_TREE into a parent repo (regression)", () => {
    // In-process `process.env.GIT_DIR = …` mutation does NOT reach
    // Bun.spawnSync's default (omitted-env) inheritance — verified: Bun
    // snapshots the real OS environ at process start, not the live JS
    // `process.env` object, for that path. A real Husky pre-push hook sets
    // GIT_DIR/GIT_WORK_TREE in its actual OS environ and then execs
    // `bun run …`, which genuinely inherits it. So this test spawns a real
    // child `bun` process with GIT_DIR/GIT_WORK_TREE in ITS environment —
    // that process then calls `findChangesetViolations` and every git spawn
    // nested inside it inherits the leak exactly like the real incident did.
    const root = makeTempRoot("changeset-guard-leak-");
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
