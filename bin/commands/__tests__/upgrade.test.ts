import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { upgradeCommand } from "../upgrade";

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

const FEATURE_ENTRY = JSON.stringify([
  { version: "0.166.0", type: "fix", title: "feature fix" },
]);

function tmp(files: Record<string, string>): string {
  const t = makeTempCwd(files);
  cleanups.push(t.cleanup);
  return t.cwd;
}

async function runJson(cwd: string, from: string): Promise<{ pending: Array<{ title: string }> }> {
  const spy = makeSpyOutput();
  const exit = await upgradeCommand.run(
    makeContext({ cwd, argv: ["--from", from, "--json"], out: spy.out }),
  );
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

    const exit = await upgradeCommand.run(
      makeContext({ cwd, argv: ["--from", "latest", "--json"], out: spy.out }),
    );

    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toContain("Invalid version format");
    expect(spy.logs).toEqual([]);
  });
});
