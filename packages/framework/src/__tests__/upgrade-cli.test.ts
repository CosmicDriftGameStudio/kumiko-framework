import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCodemodScript, runUpgradeCli, type UpgradeCliOut } from "../upgrade-cli";

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

async function runJson(cwd: string, from: string): Promise<{ pending: Array<{ title: string }> }> {
  const spy = makeSpyOutput();
  const exit = await runUpgradeCli(["--from", from, "--json"], cwd, spy.out);
  expect(exit).toBe(0);
  return JSON.parse(spy.logs.join("\n"));
}

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

// The repo actually checked out on disk — scripts/codemod/ isn't published,
// so --apply only ever works against a real local framework checkout.
const REAL_REPO_ROOT = join(import.meta.dir, "../../../..");
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

describe("resolveCodemodScript", () => {
  test("resolves a real script under scripts/codemod/", () => {
    const resolved = resolveCodemodScript(REAL_REPO_ROOT, REAL_CODEMOD);
    expect(resolved).toBe(join(REAL_REPO_ROOT, REAL_CODEMOD));
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
    expect(resolveCodemodScript(REAL_REPO_ROOT, "scripts/codemod/README.md")).toBeNull();
  });

  test("rejects a script that doesn't exist", () => {
    expect(resolveCodemodScript(REAL_REPO_ROOT, "scripts/codemod/does-not-exist.ts")).toBeNull();
  });

  test("rejects an undefined codemod field", () => {
    expect(resolveCodemodScript(REAL_REPO_ROOT, undefined)).toBeNull();
  });
});

describe("upgrade command — --apply", () => {
  test("runs the real codemod against a fixture file and writes the marker", async () => {
    const cwd = tmp({
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
    expect(marker.version).toBe("0.167.0");
    expect(typeof marker.appliedAt).toBe("string");
    expect(marker.codemods).toEqual([
      { version: "0.167.0", codemod: REAL_CODEMOD, title: "helper moved" },
    ]);
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

  test("breaking changes without a codemod field are reported as manual, no marker written", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(undefined),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(["--from", "0.165.0", "--apply"], cwd, spy.out, {
      repoRoot: REAL_REPO_ROOT,
    });

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("no codemod, manual migration required");
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("nothing pending: reports up to date, still bootstraps the marker", async () => {
    const cwd = tmp({
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
    expect(marker.version).toBe("0.170.0");
    expect(marker.codemods).toEqual([]);
    expect(typeof marker.appliedAt).toBe("string");
  });

  test("nothing pending + --dry-run: reports up to date, writes no marker", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
    });
    const spy = makeSpyOutput();

    const exit = await runUpgradeCli(
      ["--from", "0.170.0", "--apply", "--dry-run"],
      cwd,
      spy.out,
      {
        repoRoot: REAL_REPO_ROOT,
      },
    );

    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("Nothing new since your version");
    expect(existsSync(join(cwd, ".kumiko/upgrade-state.json"))).toBe(false);
  });

  test("--dir targets a different directory than cwd", async () => {
    const cwd = tmp({
      "packages/framework/src/changes.json": breakingEntryWithCodemod(REAL_CODEMOD),
    });
    const target = tmp({ "legacy-test-helper.ts": LEGACY_IMPORT_FIXTURE });
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
