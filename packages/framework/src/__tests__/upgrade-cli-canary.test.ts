import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpgradeCli } from "../upgrade-cli.ts";
import type { UpgradeCliOut } from "../upgrade-cli-internals.ts";
import { manualEntryId } from "../upgrade-marker-parse.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tmp(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), "kumiko-upgrade-canary-"));
  dirs.push(cwd);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(cwd, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return cwd;
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

describe("upgrade command — canary installs (0.425.0-next-<datetime>-<sha>)", () => {
  const CANARY_A = "0.425.0-next-20261118090000-abc1234";
  const CANARY_B = "0.425.0-next-20261118143000-0f00ba1";
  const CODEMOD = "scripts/codemod/x.ts";
  const MANUAL_TITLE = "manual step of 0.425.0";
  const ENTRIES = [
    { version: "0.424.1", type: "fix", title: "already released fix" },
    { version: "0.425.0", type: "fix", title: "fix of 0.425.0" },
    {
      version: "0.425.0",
      type: "breaking",
      title: "codemod of 0.425.0",
      migration: "run it",
      codemod: CODEMOD,
    },
    { version: "0.425.0", type: "breaking", title: MANUAL_TITLE, migration: "by hand" },
    { version: "0.426.0", type: "fix", title: "not installed yet" },
  ];
  const markerAt = (version: string): string =>
    JSON.stringify({
      version,
      appliedAt: "2026-11-18T09:00:00Z",
      codemods: [{ version: "0.425.0", codemod: CODEMOD, title: "codemod of 0.425.0" }],
      pendingManual: [
        { id: manualEntryId("0.425.0", MANUAL_TITLE), version: "0.425.0", title: MANUAL_TITLE },
      ],
    });

  function canaryRepo(
    installed: string,
    extra: Record<string, string> = {},
    entries: readonly object[] = ENTRIES,
  ): string {
    return tmp({
      "packages/framework/src/changes.json": JSON.stringify(entries),
      "packages/bundled-features/package.json": JSON.stringify({ version: installed }),
      ...extra,
    });
  }

  async function pendingTitles(cwd: string, args: readonly string[]): Promise<string[]> {
    const spy = makeSpyOutput();
    const exit = await runUpgradeCli([...args, "--json"], cwd, spy.out);
    expect(spy.errs).toEqual([]);
    expect(exit).toBe(0);
    return JSON.parse(spy.logs.join("\n")).pending.map((entry: { title: string }) => entry.title);
  }

  test("from the previous release, a canary's own release entries are pending and later ones are not", async () => {
    const cwd = canaryRepo(CANARY_A);

    expect((await pendingTitles(cwd, ["--from", "0.424.1"])).sort()).toEqual(
      ["codemod of 0.425.0", "fix of 0.425.0", MANUAL_TITLE].sort(),
    );
  });

  test("a marker written at a canary is valid and what it recorded is not pending again", async () => {
    const cwd = canaryRepo(CANARY_B, { ".kumiko/upgrade-state.json": markerAt(CANARY_A) });

    expect(await pendingTitles(cwd, [])).toEqual([]);
    expect(await pendingTitles(cwd, ["--from", CANARY_A])).toEqual([]);
  });

  test("a later canary surfaces only the 0.425.0 entry the marker has not recorded", async () => {
    const added = {
      version: "0.425.0",
      type: "breaking",
      title: "added in canary B",
      migration: "x",
    };
    const cwd = canaryRepo(CANARY_B, { ".kumiko/upgrade-state.json": markerAt(CANARY_A) }, [
      ...ENTRIES,
      added,
    ]);

    expect(await pendingTitles(cwd, ["--from", CANARY_A])).toEqual(["added in canary B"]);
  });

  test("the release after a canary keeps what the canary marker recorded", async () => {
    const cwd = canaryRepo("0.425.0", { ".kumiko/upgrade-state.json": markerAt(CANARY_B) });

    expect(await pendingTitles(cwd, [])).toEqual([]);
  });

  test("without a marker the installed canary is the baseline", async () => {
    const cwd = canaryRepo(CANARY_A);

    expect(await pendingTitles(cwd, [])).toEqual([]);
  });

  test("an explicit --from canary without a marker does not mark its release as handled", async () => {
    const cwd = canaryRepo("0.425.0");

    expect((await pendingTitles(cwd, ["--from", CANARY_A])).sort()).toEqual(
      ["codemod of 0.425.0", "fix of 0.425.0", MANUAL_TITLE].sort(),
    );
  });

  test("an unreadable marker with --from a canary keeps the release entries pending", async () => {
    const cwd = canaryRepo(CANARY_B, { ".kumiko/upgrade-state.json": "{not json" });

    expect((await pendingTitles(cwd, ["--from", CANARY_A])).sort()).toEqual(
      ["codemod of 0.425.0", "fix of 0.425.0", MANUAL_TITLE].sort(),
    );
  });

  test("a malformed --from names the accepted prerelease format", async () => {
    const spy = makeSpyOutput();
    const exit = await runUpgradeCli(["--from", "garbage"], canaryRepo(CANARY_A), spy.out);

    expect(exit).not.toBe(0);
    expect(spy.errs.join("\n")).toContain("expected x.y.z or x.y.z-<prerelease>");
  });
});
