import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  findCodemodScriptsRoot,
  findFeatureChangelogFiles,
  findFeaturesDirs,
  findPackageChangelogFiles,
  manualEntryId,
  resolveCodemodScript,
  runUpgradeCli,
  type UpgradeCliOut,
} from "../upgrade-cli.js";

type MarkerFile = {
  readonly version: string;
  readonly appliedAt: string;
  readonly codemods: readonly unknown[];
  readonly pendingManual?: readonly { id: string; version: string; title: string }[];
  readonly resolvedManual?: readonly {
    id: string;
    resolution: string;
    reason: string;
    resolvedAt: string;
  }[];
};

function readMarkerFile(cwd: string): MarkerFile {
  return JSON.parse(readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8")) as MarkerFile;
}

function makeSpyOutput(): {
  readonly out: UpgradeCliOut;
  readonly logs: string[];
  readonly errs: string[];
} {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    logs,
    errs,
    out: {
      log: (m: string) => logs.push(m),
      err: (m: string) => errs.push(m),
    },
  };
}

function makeTempCwd(files?: Record<string, string>): {
  readonly cwd: string;
  readonly cleanup: () => void;
} {
  const cwd = mkdtempSync(join(tmpdir(), "kumiko-upgrade-cli-"));
  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(cwd, relPath);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content, "utf-8");
    }
  }
  return {
    cwd,
    cleanup: () => {
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // ignore — best-effort
      }
    },
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

const CORE_ENTRY = JSON.stringify([
  {
    version: "0.167.0",
    type: "breaking",
    title: "core helper moved",
    migration: "import from /testing",
  },
]);

const FEATURE_ENTRY = JSON.stringify([{ version: "0.166.0", type: "fix", title: "feature fix" }]);

function tmp(files: Record<string, string>): string {
  const t = makeTempCwd(files);
  cleanups.push(t.cleanup);
  return t.cwd;
}

async function runJson(
  cwd: string,
  from: string,
): Promise<{ pending: Array<{ title: string }>; pendingManual: readonly unknown[] }> {
  const spy = makeSpyOutput();
  const exit = await runUpgradeCli(["--from", from, "--json"], cwd, spy.out);
  expect(exit).toBe(0);
  return JSON.parse(spy.logs.join("\n"));
}

describe("upgrade command — --help", () => {
  test("--help prints usage and exits 0 without touching the filesystem", async () => {
    const spy = makeSpyOutput();
    const exit = await runUpgradeCli(["--help"], "/nonexistent-cwd", spy.out);
    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("kumiko-upgrade");
    expect(spy.errs).toEqual([]);
  });

  test("-h behaves the same as --help", async () => {
    const spy = makeSpyOutput();
    const exit = await runUpgradeCli(["-h"], "/nonexistent-cwd", spy.out);
    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("--apply");
  });
});

describe("upgrade command — framework core changelog", () => {
  test("collects core changes.json from the framework repo layout", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": CORE_ENTRY,
      "packages/bundled-features/src/user/changes.json": FEATURE_ENTRY,
    });

    const result = await runJson(cwd, "0.165.0");

    expect(result.pending.map((e) => e.title)).toEqual(["core helper moved", "feature fix"]);
  });

  test("finds core changes.json in hoisted node_modules from an app subdir", async () => {
    const cwd = tmp({
      "node_modules/@cosmicdrift/kumiko-framework/src/changes.json": CORE_ENTRY,
      "apps/web/package.json": "{}",
    });

    const result = await runJson(`${cwd}/apps/web`, "0.165.0");

    expect(result.pending.map((e) => e.title)).toEqual(["core helper moved"]);
  });

  test("repo file wins over node_modules — no duplicate entries", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": CORE_ENTRY,
      "node_modules/@cosmicdrift/kumiko-framework/src/changes.json": CORE_ENTRY,
    });

    const result = await runJson(cwd, "0.165.0");

    expect(result.pending).toHaveLength(1);
  });

  test("feature entries are not duplicated by the workspace symlink", async () => {
    const cwd = tmp({
      "packages/bundled-features/src/user/changes.json": FEATURE_ENTRY,
      "node_modules/@cosmicdrift/kumiko-bundled-features/src/user/changes.json": FEATURE_ENTRY,
    });

    const result = await runJson(cwd, "0.165.0");

    expect(result.pending).toHaveLength(1);
  });

  test("core entries older than the current version are filtered out", async () => {
    const cwd = tmp({ "packages/framework/src/changes.json": CORE_ENTRY });

    const result = await runJson(cwd, "0.167.0");

    expect(result.pending).toEqual([]);
  });

  test("--from is rejected when it isn't a valid semver — no silent 'nothing new'", async () => {
    const cwd = tmp({ "packages/framework/src/changes.json": CORE_ENTRY });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "latest", "--json"], cwd, spy.out);

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("Invalid version format");
    expect(spy.logs).toEqual([]);
  });

  test("--json installedVersion reflects the actually installed version, not an echo of --from", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": CORE_ENTRY,
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--json"], cwd, spy.out);

    expect(exit).toBe(0);
    const result = JSON.parse(spy.logs.join("\n"));
    expect(result.currentVersion).toBe("0.165.0");
    expect(result.installedVersion).toBe("0.190.0");
  });

  test("--json without --from: currentVersion and installedVersion both come from the installed package", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": CORE_ENTRY,
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--json"], cwd, spy.out);

    expect(exit).toBe(0);
    const result = JSON.parse(spy.logs.join("\n"));
    expect(result.currentVersion).toBe("0.190.0");
    expect(result.installedVersion).toBe("0.190.0");
  });

  test("--json installedVersion is null when nothing is installed and --from is given", async () => {
    const cwd = tmp({ "packages/framework/src/changes.json": CORE_ENTRY });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--json"], cwd, spy.out);

    expect(exit).toBe(0);
    const result = JSON.parse(spy.logs.join("\n"));
    expect(result.installedVersion).toBeNull();
  });
});

describe("upgrade command — installed version comes from the repo's own package", () => {
  const CLI_ENTRY = JSON.stringify([{ version: "0.340.0", type: "fix", title: "cli fix" }]);
  const ISOLATED_CONSUMER = {
    "node_modules/@cosmicdrift/kumiko-cli/package.json": JSON.stringify({ version: "0.345.0" }),
    "node_modules/@cosmicdrift/kumiko-cli/src/changes.json": CLI_ENTRY,
  };
  const LOCKFILE = [
    "{",
    '  "packages": {',
    '    "@cosmicdrift/kumiko-bundled-features": ["@cosmicdrift/kumiko-bundled-features@0.345.0", "", {}],',
    '    "@cosmicdrift/kumiko-cli": ["@cosmicdrift/kumiko-cli@0.345.0", "", {}],',
    "  }",
    "}",
  ].join("\n");

  async function installedVersionAt(cwd: string): Promise<unknown> {
    const spy = makeSpyOutput();
    const exit = await runUpgradeCli(["--from", "0.300.0", "--json"], cwd, spy.out);
    expect(exit).toBe(0);
    return JSON.parse(spy.logs.join("\n")).installedVersion;
  }

  test("isolated linker: transitive bundled-features version is read from the own bun.lock", async () => {
    const cwd = tmp({ ...ISOLATED_CONSUMER, "bun.lock": LOCKFILE });

    expect(await installedVersionAt(cwd)).toBe("0.345.0");
  });

  test("worktree inside a parent workspace ignores the parent's installed version", async () => {
    const workspace = tmp({
      "node_modules/@cosmicdrift/kumiko-bundled-features/package.json": JSON.stringify({
        version: "0.999.0",
      }),
      ...Object.fromEntries(
        Object.entries({ ...ISOLATED_CONSUMER, "bun.lock": LOCKFILE }).map(([path, content]) => [
          `.wt/consumer/${path}`,
          content,
        ]),
      ),
    });

    expect(await installedVersionAt(join(workspace, ".wt/consumer"))).toBe("0.345.0");
  });

  test("without an own install or lockfile the parent's version is not borrowed", async () => {
    const workspace = tmp({
      "node_modules/@cosmicdrift/kumiko-bundled-features/package.json": JSON.stringify({
        version: "0.999.0",
      }),
      "consumer/node_modules/@cosmicdrift/kumiko-cli/src/changes.json": CLI_ENTRY,
    });

    expect(await installedVersionAt(join(workspace, "consumer"))).toBeNull();
  });
});

describe("upgrade command — every package's changelog, not just framework core", () => {
  const SERVER_RUNTIME_ENTRY = JSON.stringify([
    { version: "0.168.0", type: "breaking", title: "server-runtime breaking change" },
  ]);

  test("a hoisted non-framework, non-bundled-features package's changes.json shows up in pending", async () => {
    const cwd = tmp({
      "node_modules/@cosmicdrift/kumiko-server-runtime/src/changes.json": SERVER_RUNTIME_ENTRY,
      "apps/web/package.json": "{}",
    });

    const result = await runJson(`${cwd}/apps/web`, "0.165.0");

    expect(result.pending.map((e) => e.title)).toEqual(["server-runtime breaking change"]);
  });

  test("bundled-features is never double-counted alongside findFeaturesDirs's own collection", async () => {
    const cwd = tmp({
      "node_modules/@cosmicdrift/kumiko-server-runtime/src/changes.json": SERVER_RUNTIME_ENTRY,
      "node_modules/@cosmicdrift/kumiko-bundled-features/src/user/changes.json": FEATURE_ENTRY,
      "apps/web/package.json": "{}",
    });

    const result = await runJson(`${cwd}/apps/web`, "0.165.0");

    expect(result.pending.map((e) => e.title).sort()).toEqual(
      ["feature fix", "server-runtime breaking change"].sort(),
    );
  });
});

describe("upgrade command — enterprise package layout", () => {
  // Layout is detected by presence of changes.json, not an "ai-" name
  // prefix — the old heuristic silently dropped every enterprise package
  // whose name didn't start with "ai-" (fw#1605).
  test("collects changes.json from a package without an 'ai-' prefix", async () => {
    const cwd = tmp({
      "packages/billing-designer/src/changes.json": FEATURE_ENTRY,
    });

    const result = await runJson(cwd, "0.165.0");

    expect(result.pending.map((e) => e.title)).toEqual(["feature fix"]);
  });

  test("flat layout (no src/ subdir) is also collected", async () => {
    const cwd = tmp({
      "packages/billing-designer/changes.json": FEATURE_ENTRY,
    });

    const result = await runJson(cwd, "0.165.0");

    expect(result.pending.map((e) => e.title)).toEqual(["feature fix"]);
  });
});

// Codemod scripts ship inside packages/framework/src/scripts/codemod — the
// published @cosmicdrift/kumiko-framework package (fw#2301).
const REAL_REPO_ROOT = join(import.meta.dir, "../../../..");
const REAL_FRAMEWORK_SRC = join(import.meta.dir, "..");
const REAL_FRAMEWORK_PACKAGE_DIR = join(REAL_FRAMEWORK_SRC, "..");
const REAL_CODEMOD = "scripts/codemod/crypto-shredding-testing-move.ts";

function breakingEntryWithCodemod(codemod: string | undefined): string {
  const entry: Record<string, unknown> = {
    version: "0.167.0",
    type: "breaking",
    title: "helper moved",
    migration: "import from /testing",
  };
  if (codemod !== undefined) entry["codemod"] = codemod;
  return JSON.stringify([entry]);
}

const LEGACY_IMPORT_FIXTURE = [
  'import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/crypto";',
  "",
  "resetPiiSubjectKmsForTests();",
  "",
].join("\n");

// A dedicated fixture — not the real repo's scripts/codemod/ — so the
// non-.ts and doesn't-exist cases below are isolated from whatever files
// happen to exist in the real tree. README.md is created for real so a
// non-.ts rejection is provably caused by the extension check, not by the
// existsSync guard rejecting a file that never existed.
function makeCodemodScriptsFixture(): string {
  return tmp({ "scripts/codemod/README.md": "# Codemods\n" });
}

describe("resolveCodemodScript", () => {
  test("resolves a real script under scripts/codemod/", () => {
    const resolved = resolveCodemodScript(REAL_REPO_ROOT, REAL_CODEMOD);
    expect(resolved).toBe(join(REAL_FRAMEWORK_SRC, REAL_CODEMOD));
  });

  test("rejects an absolute path", () => {
    expect(resolveCodemodScript(REAL_REPO_ROOT, "/etc/passwd.ts")).toBeNull();
  });

  test("rejects path traversal that escapes scripts/codemod/", () => {
    expect(
      resolveCodemodScript(REAL_REPO_ROOT, "scripts/codemod/../../package.json.ts"),
    ).toBeNull();
    expect(resolveCodemodScript(REAL_REPO_ROOT, "../outside/x.ts")).toBeNull();
  });

  test("rejects a non-.ts file", () => {
    const root = makeCodemodScriptsFixture();

    expect(resolveCodemodScript(root, "scripts/codemod/README.md")).toBeNull();
  });

  test("rejects a script that doesn't exist", () => {
    const root = makeCodemodScriptsFixture();

    expect(resolveCodemodScript(root, "scripts/codemod/does-not-exist.ts")).toBeNull();
  });

  test("rejects an undefined codemod field", () => {
    expect(resolveCodemodScript(REAL_REPO_ROOT, undefined)).toBeNull();
  });

  test("findPackageChangelogFiles follows workspace-symlinked @cosmicdrift packages", () => {
    const cwd = tmp({
      "linked/framework/src/changes.json": "[]",
      "apps/web/package.json": "{}",
    });
    const scopeDir = join(cwd, "node_modules/@cosmicdrift");
    mkdirSync(scopeDir, { recursive: true });
    symlinkSync(join(cwd, "linked/framework"), join(scopeDir, "kumiko-framework"), "dir");

    expect(findPackageChangelogFiles(join(cwd, "apps/web"))).toEqual([
      join(scopeDir, "kumiko-framework/src/changes.json"),
    ]);
  });

  test("findPackageChangelogFiles: a nearer package without changes.json is not shadowed by a farther one", () => {
    const cwd = tmp({
      "node_modules/@cosmicdrift/kumiko-framework/src/changes.json": "[]",
      "apps/web/node_modules/@cosmicdrift/kumiko-framework/package.json": "{}",
    });

    expect(findPackageChangelogFiles(join(cwd, "apps/web"))).toEqual([]);
  });

  test("findCodemodScriptsRoot resolves through a hoisted node_modules symlink", () => {
    const cwd = tmp({ "apps/web/package.json": "{}" });
    const nmPkgDir = join(cwd, "node_modules/@cosmicdrift/kumiko-framework");
    mkdirSync(join(nmPkgDir, ".."), { recursive: true });
    symlinkSync(REAL_FRAMEWORK_SRC.replace(/\/src$/, ""), nmPkgDir, "dir");

    const root = findCodemodScriptsRoot(join(cwd, "apps/web"));
    expect(root).toBe(join(nmPkgDir, "src"));

    const resolved = resolveCodemodScript(join(cwd, "apps/web"), REAL_CODEMOD);
    expect(resolved).toBe(join(nmPkgDir, "src", REAL_CODEMOD));
  });
});

describe("upgrade command — --apply", () => {
  test("runs the real codemod against a fixture file and writes the marker", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "legacy-test-helper.ts": LEGACY_IMPORT_FIXTURE,
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(0);

    const rewritten = readFileSync(join(cwd, "legacy-test-helper.ts"), "utf-8");
    expect(rewritten).toContain('from "@cosmicdrift/kumiko-framework/testing"');
    expect(rewritten).not.toContain('from "@cosmicdrift/kumiko-framework/crypto"');

    const markerPath = join(cwd, ".kumiko/upgrade-state.json");
    expect(existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(readFileSync(markerPath, "utf-8"));
    expect(marker.version).toBe("0.190.0");
    expect(typeof marker.appliedAt).toBe("string");
    expect(marker.codemods).toEqual([
      { version: "0.167.0", codemod: REAL_CODEMOD, title: "helper moved" },
    ]);
  });

  test("--apply --dry-run runs a codemod from a node_modules-installed framework package", async () => {
    const consumerRoot = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(
        "scripts/codemod/migrate-db-raw.ts",
      ),
      "app.ts": "export const x = 1;\n",
    });
    const nmPkgDir = join(consumerRoot, "node_modules/@cosmicdrift/kumiko-framework");
    mkdirSync(join(nmPkgDir, ".."), { recursive: true });
    symlinkSync(REAL_FRAMEWORK_PACKAGE_DIR, nmPkgDir, "dir");
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(
      ["--from", "0.165.0", "--apply", "--dry-run"],
      consumerRoot,
      spy.out,
      {
        repoRoot: consumerRoot,
      },
    );

    expect(spy.errs).toEqual([]);
    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("running scripts/codemod/migrate-db-raw.ts (dry-run)");
    expect(existsSync(join(consumerRoot, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("--dry-run runs the codemod but changes nothing and writes no marker", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "legacy-test-helper.ts": LEGACY_IMPORT_FIXTURE,
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--apply", "--dry-run"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(0);
    expect(readFileSync(join(cwd, "legacy-test-helper.ts"), "utf-8")).toBe(LEGACY_IMPORT_FIXTURE);
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
    expect(spy.logs.join("\n")).toContain("Touched 1 files, moved 1 import(s)");
  });

  test("rejects a path-traversal codemod field and writes no marker", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": breakingEntryWithCodemod("../../../etc/passwd.ts"),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("invalid codemod path");
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("fails when the codemod script doesn't exist, writes no marker", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": breakingEntryWithCodemod(
        "scripts/codemod/does-not-exist.ts",
      ),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("invalid codemod path");
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("stops and writes no marker when the codemod script exits non-zero", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": breakingEntryWithCodemod(
        "scripts/codemod/always-fail.ts",
      ),
    });
    const failingRepoRoot = tmp({
      "packages/framework/src/scripts/codemod/always-fail.ts": "process.exit(1);\n",
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--apply"], cwd, spy.out, {
      repoRoot: failingRepoRoot,
    });

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("scripts/codemod/always-fail.ts failed");
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("a partial marker after a failing codemod keeps open and resolved manual entries", async () => {
    const open = { version: "0.160.0", title: "open before" };
    const resolved = { version: "0.150.0", title: "resolved before" };
    const withId = (e: { version: string; title: string }) => ({
      id: manualEntryId(e.version, e.title),
      ...e,
    });
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": JSON.stringify([
        {
          version: "0.167.0",
          type: "breaking",
          title: "first",
          migration: "m",
          codemod: "scripts/codemod/ok.ts",
        },
        {
          version: "0.168.0",
          type: "breaking",
          title: "second",
          migration: "m",
          codemod: "scripts/codemod/always-fail.ts",
        },
      ]),
      ".kumiko/upgrade-state.json": JSON.stringify({
        version: "0.165.0",
        appliedAt: "2024-01-01T00:00:00Z",
        codemods: [],
        pendingManual: [withId(open)],
        resolvedManual: [
          {
            ...withId(resolved),
            resolution: "migrated",
            reason: "done",
            resolvedAt: "2024-01-02T00:00:00Z",
          },
        ],
      }),
    });
    const repoRootWithScripts = tmp({
      "packages/framework/src/scripts/codemod/ok.ts": "process.exit(0);\n",
      "packages/framework/src/scripts/codemod/always-fail.ts": "process.exit(1);\n",
    });

    const exit = await runUpgradeCli(["--apply"], cwd, makeSpyOutput().out, {
      repoRoot: repoRootWithScripts,
    });

    expect(exit).toBe(1);
    const marker = readMarkerFile(cwd);
    expect(marker.version).toBe("0.167.0");
    expect(marker.pendingManual).toEqual([withId(open)]);
    expect(marker.resolvedManual?.map((e) => e.id)).toEqual([
      manualEntryId(resolved.version, resolved.title),
    ]);
  });

  test("a failing later codemod keeps the marker for the ones that already ran, so a re-run resumes", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": JSON.stringify([
        {
          version: "0.167.0",
          type: "breaking",
          title: "first",
          migration: "m",
          codemod: "scripts/codemod/ok.ts",
        },
        {
          version: "0.168.0",
          type: "breaking",
          title: "second",
          migration: "m",
          codemod: "scripts/codemod/always-fail.ts",
        },
      ]),
    });
    const repoRootWithScripts = tmp({
      "packages/framework/src/scripts/codemod/ok.ts": "process.exit(0);\n",
      "packages/framework/src/scripts/codemod/always-fail.ts": "process.exit(1);\n",
    });

    const firstRun = makeSpyOutput();
    const firstExit = await runUpgradeCli(["--from", "0.165.0", "--apply"], cwd, firstRun.out, {
      repoRoot: repoRootWithScripts,
    });

    expect(firstExit).toBe(1);
    const marker = JSON.parse(readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8"));
    expect(marker.version).toBe("0.167.0");
    expect(marker.codemods).toEqual([
      { version: "0.167.0", codemod: "scripts/codemod/ok.ts", title: "first" },
    ]);

    const rerun = makeSpyOutput();
    const rerunExit = await runUpgradeCli(["--apply"], cwd, rerun.out, {
      repoRoot: repoRootWithScripts,
    });

    expect(rerunExit).toBe(1);
    const rerunLog = rerun.logs.join("\n");
    expect(rerunLog).toContain("running scripts/codemod/always-fail.ts");
    expect(rerunLog).not.toContain("running scripts/codemod/ok.ts");
  });

  test("breaking changes without a codemod field are reported as manual; marker still written", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": breakingEntryWithCodemod(undefined),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("no codemod, manual migration required");
    // Marker must be written so guard-upgrade-state is not stuck when only
    // manuals/improvements remain (fw#2299 / #2308). Manuals stay pending via
    // markerVersionForPending not advancing onto them when mixed with later work.
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(true);
  });

  test("nothing pending: reports up to date, still bootstraps the marker", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.170.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("Nothing new since your version");

    const markerPath = join(cwd, ".kumiko/upgrade-state.json");
    expect(existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(readFileSync(markerPath, "utf-8"));
    expect(marker.version).toBe("0.190.0");
    expect(marker.codemods).toEqual([]);
    expect(typeof marker.appliedAt).toBe("string");
  });

  test("nothing pending + --from: marker records installed version, not the filter", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.999.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(0);
    const marker = JSON.parse(readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8"));
    expect(marker.version).toBe("0.190.0");
  });

  test("--from without any installed version exits 1 without writing a marker", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.999.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(1);
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("--dir without a readable version exits 1 even when cwd has one", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      "other/placeholder.txt": "x",
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(
      ["--from", "0.165.0", "--apply", "--dir", join(cwd, "other")],
      cwd,
      spy.out,
      { repoRoot: REAL_REPO_ROOT },
    );

    expect(exit).toBe(1);
    expect(existsSync(join(cwd, "other/.kumiko/upgrade-state.json"))).toBe(false);
  });

  test("--dir that is not a directory exits 1 without writing a marker", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "not-a-dir.txt": "x",
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(
      ["--from", "0.165.0", "--apply", "--dir", join(cwd, "not-a-dir.txt")],
      cwd,
      spy.out,
      { repoRoot: REAL_REPO_ROOT },
    );

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("not a directory");
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("nothing pending + --dry-run: reports up to date, writes no marker", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.170.0", "--apply", "--dry-run"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("Nothing new since your version");
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("--dir targets a different directory than cwd", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
    });
    const target = tmp({
      "legacy-test-helper.ts": LEGACY_IMPORT_FIXTURE,
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(
      ["--from", "0.165.0", "--apply", "--dir", target],
      cwd,
      spy.out,
      {
        repoRoot: REAL_REPO_ROOT,
      },
    );

    expect(exit).toBe(0);
    const rewritten = readFileSync(join(target, "legacy-test-helper.ts"), "utf-8");
    expect(rewritten).toContain('from "@cosmicdrift/kumiko-framework/testing"');
    expect(existsSync(join(target, ".kumiko/upgrade-state.json"))).toBe(true);
  });
});

// Bug: without --from, the filter baseline used to be the installed
// version, not the recorded marker — a bare `--apply` always reported
// "Nothing new" and bootstrapped the marker onto the installed version,
// hiding changelog entries the marker never actually saw (fw#2371-style).
describe("upgrade command — filter baseline is the marker, not the installed version", () => {
  const marker = (version: string): string =>
    JSON.stringify({ version, appliedAt: "2024-01-01T00:00:00Z", codemods: [] });

  test("bare --apply with a marker below installed: the entry between them is pending, not 'Nothing new'", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      ".kumiko/upgrade-state.json": marker("0.160.0"),
      "legacy-test-helper.ts": LEGACY_IMPORT_FIXTURE,
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--apply"], cwd, spy.out, { repoRoot: REAL_REPO_ROOT });

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).not.toContain("Nothing new since your version");
    const rewritten = readFileSync(join(cwd, "legacy-test-helper.ts"), "utf-8");
    expect(rewritten).toContain('from "@cosmicdrift/kumiko-framework/testing"');
    const updatedMarker = JSON.parse(
      readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8"),
    );
    expect(updatedMarker.version).toBe("0.190.0");
  });

  test("bare --apply with a corrupt marker exits 1 and leaves the marker untouched", async () => {
    const corrupt = "<<<<<<< HEAD\n{}\n";
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.190.0" }),
      ".kumiko/upgrade-state.json": corrupt,
      "legacy-test-helper.ts": LEGACY_IMPORT_FIXTURE,
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--apply"], cwd, spy.out, { repoRoot: REAL_REPO_ROOT });

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("invalid .kumiko/upgrade-state.json");
    expect(readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8")).toBe(corrupt);
    expect(readFileSync(join(cwd, "legacy-test-helper.ts"), "utf-8")).toBe(LEGACY_IMPORT_FIXTURE);
  });

  test("bare --apply with a manual breaking change: one run moves the marker to installed, pendingManual records it with an id", async () => {
    const manualEntry = { version: "0.185.0", type: "breaking", title: "manual breaking change" };
    const fixEntry = { version: "0.188.0", type: "fix", title: "later fix" };
    const cwd = tmp({
      "packages/framework/src/changes.json": JSON.stringify([manualEntry, fixEntry]),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.195.0" }),
      ".kumiko/upgrade-state.json": marker("0.180.0"),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--apply"], cwd, spy.out, { repoRoot: REAL_REPO_ROOT });

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("no codemod, manual migration required");
    const updatedMarker = readMarkerFile(cwd);
    expect(updatedMarker.version).toBe("0.195.0");
    expect(updatedMarker.pendingManual).toEqual([
      {
        id: manualEntryId("0.185.0", "manual breaking change"),
        version: "0.185.0",
        title: "manual breaking change",
      },
    ]);
    const logs = spy.logs.join("\n");
    expect(logs).toContain(`${manualEntryId("0.185.0", "manual breaking change")} · 0.185.0`);
    expect(logs).toContain("--resolve");
    expect(logs).not.toContain("run --apply again");
  });

  test("after one --apply with an open manual entry, the guard's `--from <marker> --json` sees nothing pending", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": JSON.stringify([
        { version: "0.311.0", type: "breaking", title: "manual breaking change" },
      ]),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.311.0" }),
      ".kumiko/upgrade-state.json": marker("0.309.0"),
    });

    expect(
      await runUpgradeCli(["--apply"], cwd, makeSpyOutput().out, { repoRoot: REAL_REPO_ROOT }),
    ).toBe(0);
    const stamped = readMarkerFile(cwd);
    expect(stamped.version).toBe("0.311.0");

    const result = await runJson(cwd, stamped.version);
    expect(result.pending).toEqual([]);
    expect(result.pendingManual).toEqual(stamped.pendingManual ?? []);
  });

  test("a second --apply without new entries keeps the open manual entries", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": JSON.stringify([
        { version: "0.311.0", type: "breaking", title: "manual breaking change" },
      ]),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.311.0" }),
      ".kumiko/upgrade-state.json": marker("0.309.0"),
    });
    await runUpgradeCli(["--apply"], cwd, makeSpyOutput().out, { repoRoot: REAL_REPO_ROOT });
    const afterFirst = readMarkerFile(cwd);

    const second = makeSpyOutput();
    expect(await runUpgradeCli(["--apply"], cwd, second.out, { repoRoot: REAL_REPO_ROOT })).toBe(0);

    expect(second.logs.join("\n")).toContain("Nothing new since your version");
    expect(readMarkerFile(cwd).pendingManual).toEqual(afterFirst.pendingManual);
    expect(second.logs.join("\n")).toContain("still open");
  });

  test("a legacy pendingManual entry without id gets the computed id", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": JSON.stringify([]),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.311.0" }),
      ".kumiko/upgrade-state.json": JSON.stringify({
        version: "0.309.0",
        appliedAt: "2024-01-01T00:00:00Z",
        codemods: [],
        pendingManual: [{ version: "0.305.0", title: "legacy entry" }],
      }),
    });

    await runUpgradeCli(["--apply"], cwd, makeSpyOutput().out, { repoRoot: REAL_REPO_ROOT });

    expect(readMarkerFile(cwd).pendingManual).toEqual([
      { id: manualEntryId("0.305.0", "legacy entry"), version: "0.305.0", title: "legacy entry" },
    ]);
  });

  test("entries with the same version but different titles get distinct ids; identical ones are deduplicated", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": JSON.stringify([
        { version: "0.311.0", type: "breaking", title: "first" },
        { version: "0.311.0", type: "breaking", title: "second" },
        { version: "0.311.0", type: "breaking", title: "second" },
      ]),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.311.0" }),
      ".kumiko/upgrade-state.json": marker("0.309.0"),
    });

    await runUpgradeCli(["--apply"], cwd, makeSpyOutput().out, { repoRoot: REAL_REPO_ROOT });

    const ids = (readMarkerFile(cwd).pendingManual ?? []).map((entry) => entry.title);
    expect(ids).toEqual(["first", "second"]);
    expect(manualEntryId("0.311.0", "first")).not.toBe(manualEntryId("0.311.0", "second"));
  });

  test("bare --apply with no marker (bootstrap): behaves as before, marker is written at the installed version", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
      "packages/framework/package.json": JSON.stringify({ version: "0.170.0" }),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--apply"], cwd, spy.out, { repoRoot: REAL_REPO_ROOT });

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("Nothing new since your version");
    const updatedMarker = JSON.parse(
      readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8"),
    );
    expect(updatedMarker.version).toBe("0.170.0");
  });

  test("--from wins over an existing marker", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": JSON.stringify([
        { version: "0.175.0", type: "fix", title: "explicit-from-test-entry" },
      ]),
      ".kumiko/upgrade-state.json": marker("0.180.0"),
    });

    const result = await runJson(cwd, "0.170.0");

    expect(result.pending.map((e) => e.title)).toEqual(["explicit-from-test-entry"]);
  });
});

describe("changes.json codemod fields resolve to real published scripts", () => {
  test("every codemod field is a scripts/codemod/*.ts path that resolves to an existing published script", () => {
    const changesJsonFiles = [
      ...findPackageChangelogFiles(REAL_REPO_ROOT),
      ...findFeaturesDirs(REAL_REPO_ROOT).flatMap((dir) => findFeatureChangelogFiles(dir)),
    ];
    expect(changesJsonFiles.length).toBeGreaterThan(0);

    const publishedFileEntries = (
      JSON.parse(readFileSync(join(REAL_FRAMEWORK_PACKAGE_DIR, "package.json"), "utf-8")) as {
        readonly files: readonly string[];
      }
    ).files;

    const offenders: string[] = [];
    for (const file of changesJsonFiles) {
      const entries = JSON.parse(readFileSync(file, "utf-8")) as ReadonlyArray<{
        readonly version: string;
        readonly title: string;
        readonly codemod?: string;
      }>;
      for (const entry of entries) {
        if (typeof entry.codemod !== "string") continue;
        if (/\s/.test(entry.codemod)) {
          offenders.push(
            `${file} · ${entry.version} "${entry.title}": codemod is a shell command, not a path: "${entry.codemod}"`,
          );
          continue;
        }
        const resolved = resolveCodemodScript(REAL_REPO_ROOT, entry.codemod);
        if (resolved === null) {
          offenders.push(
            `${file} · ${entry.version} "${entry.title}": codemod path does not resolve: "${entry.codemod}"`,
          );
          continue;
        }
        // Resolving inside the git checkout proves nothing about the npm
        // tarball: the script must also sit under a package.json `files` entry.
        const relToPackage = relative(REAL_FRAMEWORK_PACKAGE_DIR, resolved);
        const shipped = publishedFileEntries.some(
          (entryPath) => relToPackage === entryPath || relToPackage.startsWith(`${entryPath}/`),
        );
        if (!shipped) {
          offenders.push(
            `${file} · ${entry.version} "${entry.title}": ${relToPackage} is not covered by package.json "files"`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("upgrade command — --resolve", () => {
  const OPEN_FIRST = { version: "0.311.0", title: "first manual change" };
  const OPEN_SECOND = { version: "0.311.0", title: "second manual change" };
  const OPEN_SINGLE = { version: "0.312.0", title: "single manual change" };
  const withId = (entry: { version: string; title: string }) => ({
    id: manualEntryId(entry.version, entry.title),
    ...entry,
  });

  function markerWithOpen(extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: "0.312.0",
      appliedAt: "2024-01-01T00:00:00Z",
      codemods: [{ version: "0.300.0", codemod: "scripts/codemod/x.ts", title: "x" }],
      pendingManual: [withId(OPEN_FIRST), withId(OPEN_SECOND), withId(OPEN_SINGLE)],
      ...extra,
    });
  }

  function fixture(): string {
    return tmp({
      "packages/framework/src/changes.json": JSON.stringify([
        { version: "0.312.0", type: "breaking", title: "single manual change" },
      ]),
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.312.0" }),
      ".kumiko/upgrade-state.json": markerWithOpen(),
    });
  }

  const resolve = async (cwd: string, args: readonly string[]) => {
    const spy = makeSpyOutput();
    const exit = await runUpgradeCli(["--resolve", ...args], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });
    return { exit, spy };
  };

  test("resolves by full id: moves the entry to resolvedManual and leaves version, appliedAt and codemods alone", async () => {
    const cwd = fixture();
    const before = readMarkerFile(cwd);

    const { exit } = await resolve(cwd, [
      manualEntryId("0.311.0", "first manual change"),
      "--reason",
      "done by hand",
    ]);

    expect(exit).toBe(0);
    const after = readMarkerFile(cwd);
    expect(after.version).toBe(before.version);
    expect(after.appliedAt).toBe(before.appliedAt);
    expect(after.codemods).toEqual(before.codemods);
    expect(after.pendingManual?.map((e) => e.title)).toEqual([
      "second manual change",
      "single manual change",
    ]);
    expect(after.resolvedManual).toEqual([
      expect.objectContaining({
        id: manualEntryId("0.311.0", "first manual change"),
        resolution: "migrated",
        reason: "done by hand",
        resolvedAt: expect.any(String),
      }),
    ]);
  });

  test("strips control characters from marker titles before printing them", async () => {
    const tampered = { version: "0.311.0", title: "evil\u001b[2J title" };
    const cwd = tmp({
      "packages/framework/src/changes.json": "[]",
      "packages/bundled-features/package.json": JSON.stringify({ version: "0.312.0" }),
      ".kumiko/upgrade-state.json": markerWithOpen({
        pendingManual: [withId(OPEN_SINGLE), withId(tampered)],
      }),
    });

    const { exit, spy } = await resolve(cwd, ["0.312.0", "--reason", "migrated"]);

    expect(exit).toBe(0);
    const printed = spy.logs.join("\n");
    expect(printed).toContain("evil[2J title");
    expect(printed).not.toContain("\u001b");
  });

  test("resolves by a version that has exactly one open entry", async () => {
    const cwd = fixture();

    const { exit } = await resolve(cwd, ["0.312.0", "--reason", "migrated"]);

    expect(exit).toBe(0);
    expect(readMarkerFile(cwd).pendingManual?.map((e) => e.version)).toEqual([
      "0.311.0",
      "0.311.0",
    ]);
  });

  test("an ambiguous version fails with the list of ids and writes nothing", async () => {
    const cwd = fixture();
    const before = readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8");

    const { exit, spy } = await resolve(cwd, ["0.311.0", "--reason", "x"]);

    expect(exit).toBe(1);
    const errs = spy.errs.join("\n");
    expect(errs).toContain(manualEntryId("0.311.0", "first manual change"));
    expect(errs).toContain(manualEntryId("0.311.0", "second manual change"));
    expect(readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8")).toBe(before);
  });

  test("an unknown ref fails all-or-nothing, even when other refs are valid", async () => {
    const cwd = fixture();
    const before = readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8");

    const { exit, spy } = await resolve(cwd, ["0.312.0,0.999.0", "--reason", "x"]);

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("0.999.0");
    expect(readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8")).toBe(before);
  });

  test("--not-applicable records the resolution as not-applicable", async () => {
    const cwd = fixture();

    const { exit } = await resolve(cwd, [
      "0.312.0",
      "--reason",
      "we do not use it",
      "--not-applicable",
    ]);

    expect(exit).toBe(0);
    expect(readMarkerFile(cwd).resolvedManual?.[0]?.resolution).toBe("not-applicable");
  });

  test.each([
    ["missing", []],
    ["empty", ["--reason", "   "]],
    ["too long", ["--reason", "x".repeat(501)]],
  ])("a %s --reason is rejected without writing", async (_name, reasonArgs) => {
    const cwd = fixture();
    const before = readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8");

    const { exit } = await resolve(cwd, ["0.312.0", ...reasonArgs]);

    expect(exit).toBe(1);
    expect(readFileSync(join(cwd, ".kumiko/upgrade-state.json"), "utf-8")).toBe(before);
  });

  test("--resolve cannot be combined with --apply", async () => {
    const cwd = fixture();
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(
      ["--resolve", "0.312.0", "--reason", "x", "--apply"],
      cwd,
      spy.out,
      {
        repoRoot: REAL_REPO_ROOT,
      },
    );

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("--apply");
  });

  test("without a marker there is nothing to resolve", async () => {
    const cwd = tmp({ "packages/framework/src/changes.json": "[]" });

    const { exit } = await resolve(cwd, ["0.312.0", "--reason", "x"]);

    expect(exit).toBe(1);
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("a resolved id does not come back on the next --apply", async () => {
    const cwd = fixture();
    await resolve(cwd, ["0.312.0", "--reason", "migrated"]);

    const second = makeSpyOutput();
    expect(
      await runUpgradeCli(["--apply", "--from", "0.311.0"], cwd, second.out, {
        repoRoot: REAL_REPO_ROOT,
      }),
    ).toBe(0);

    const after = readMarkerFile(cwd);
    expect(after.pendingManual?.map((e) => e.title)).toEqual([
      "first manual change",
      "second manual change",
    ]);
    expect(after.resolvedManual?.map((e) => e.id)).toEqual([
      manualEntryId("0.312.0", "single manual change"),
    ]);
  });

  test("the plain report lists the open manual migrations from the marker", async () => {
    const cwd = fixture();
    const spy = makeSpyOutput();

    await runUpgradeCli([], cwd, spy.out, { repoRoot: REAL_REPO_ROOT });

    const logs = spy.logs.join("\n");
    expect(logs).toContain(
      `${manualEntryId("0.311.0", "first manual change")} · 0.311.0 · first manual change`,
    );
  });
});

describe("upgrade command — --apply: one run, open manual entries survive", () => {
  const INSTALLED = "0.349.0";
  const OLD_OPEN = { version: "0.346.0", title: "old manual change" };
  const NEW_MANUAL = { version: "0.348.0", title: "new manual change" };
  const withId = (entry: { version: string; title: string }) => ({
    id: manualEntryId(entry.version, entry.title),
    ...entry,
  });

  function fixture(markerVersion: string, changes: readonly unknown[]): string {
    return tmp({
      "packages/bundled-features/package.json": JSON.stringify({ version: INSTALLED }),
      "packages/framework/src/changes.json": JSON.stringify(changes),
      ".kumiko/upgrade-state.json": JSON.stringify({
        version: markerVersion,
        appliedAt: "2024-01-01T00:00:00Z",
        codemods: [],
        pendingManual: [withId(OLD_OPEN)],
      }),
      "legacy-test-helper.ts": LEGACY_IMPORT_FIXTURE,
    });
  }

  const apply = async (cwd: string) => {
    const spy = makeSpyOutput();
    const exit = await runUpgradeCli(["--apply"], cwd, spy.out, { repoRoot: REAL_REPO_ROOT });
    return { exit, spy };
  };

  const manualBreaking = (entry: { version: string; title: string }) => ({
    ...entry,
    type: "breaking",
    migration: "by hand",
  });

  test("marker already at the installed version: version and open entry stay unchanged", async () => {
    const cwd = fixture(INSTALLED, []);
    const before = readMarkerFile(cwd);

    const { exit } = await apply(cwd);

    expect(exit).toBe(0);
    const after = readMarkerFile(cwd);
    expect(after.version).toBe(INSTALLED);
    expect(after.pendingManual).toEqual(before.pendingManual);
  });

  test("old marker with one new manual entry: one run reaches the installed version and keeps the old entry", async () => {
    const cwd = fixture("0.345.0", [manualBreaking(NEW_MANUAL)]);

    const { exit } = await apply(cwd);

    expect(exit).toBe(0);
    const after = readMarkerFile(cwd);
    expect(after.version).toBe(INSTALLED);
    expect(after.pendingManual).toEqual([withId(OLD_OPEN), withId(NEW_MANUAL)]);
  });

  test("codemod plus manual entries: deduplicated, and a second run changes nothing", async () => {
    const cwd = fixture("0.345.0", [
      {
        version: "0.347.0",
        type: "breaking",
        title: "helper moved",
        migration: "import from /testing",
        codemod: REAL_CODEMOD,
      },
      manualBreaking(NEW_MANUAL),
      manualBreaking(OLD_OPEN),
    ]);

    expect((await apply(cwd)).exit).toBe(0);
    const first = readMarkerFile(cwd);
    expect(first.version).toBe(INSTALLED);
    expect(first.pendingManual).toEqual([withId(OLD_OPEN), withId(NEW_MANUAL)]);
    expect(first.codemods).toEqual([
      { version: "0.347.0", codemod: REAL_CODEMOD, title: "helper moved" },
    ]);

    expect((await apply(cwd)).exit).toBe(0);
    const second = readMarkerFile(cwd);
    expect(second.version).toBe(INSTALLED);
    expect(second.pendingManual).toEqual(first.pendingManual);
  });

  test("manual entries at or below the marker version are not newly opened", async () => {
    const cwd = fixture("0.347.0", [
      manualBreaking({ version: "0.344.0", title: "already past" }),
      manualBreaking({ version: "0.347.0", title: "at the marker" }),
    ]);

    const { exit } = await apply(cwd);

    expect(exit).toBe(0);
    expect(readMarkerFile(cwd).pendingManual).toEqual([withId(OLD_OPEN)]);
  });
});
