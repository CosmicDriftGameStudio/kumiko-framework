import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../check-single-runtime-instance";
import { fixtureRoot } from "./parent-workspace-fixture";

const FRAMEWORK = "@cosmicdrift/kumiko-framework";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

type LockEntry = readonly [lockKey: string, resolved: string];

function lockOf(entries: readonly LockEntry[]): string {
  const packages = Object.fromEntries(entries.map(([key, resolved]) => [key, [resolved, "", {}]]));
  return JSON.stringify({ lockfileVersion: 1, packages }, null, 2);
}

// `markers` maps package name → kumiko.runtime marker (null = installed, no marker).
function makeRepo(opts: { lock?: string; markers?: Record<string, string | null> }) {
  const dir = mkdtempSync(join(tmpdir(), "single-runtime-instance-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }), "utf-8");
  if (opts.lock !== undefined) writeFileSync(join(dir, "bun.lock"), opts.lock, "utf-8");
  for (const [name, marker] of Object.entries(opts.markers ?? {})) {
    const pkgDir = join(dir, "node_modules", name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(marker === null ? { name } : { name, kumiko: { runtime: marker } }),
      "utf-8",
    );
  }
  return fixtureRoot("fixture", dir, {
    kind: "app",
    sourceRoots: ["src"],
    testGlobs: ["src/**/*.test.ts"],
  });
}

describe("Single-Runtime-Instance Guard", () => {
  test("flags a nested runtime-marked Kumiko package at a drifting version", async () => {
    const root = makeRepo({
      lock: lockOf([
        [FRAMEWORK, `${FRAMEWORK}@0.323.0`],
        [`@cosmicdrift/kumiko-feature/${FRAMEWORK}`, `${FRAMEWORK}@0.285.0`],
      ]),
      markers: { [FRAMEWORK]: "runtime" },
    });
    const outcome = await check.run([root]);
    expect(outcome.notApplicable).toBe(false);
    expect(outcome.matchedFiles).toBe(1);
    expect(outcome.violations).toHaveLength(1);
    const v = outcome.violations[0];
    expect(v?.file).toBe("bun.lock");
    expect(v?.line).toBeGreaterThan(1);
    expect(v?.message).toContain(FRAMEWORK);
    expect(v?.message).toContain("runtime");
    expect(v?.message).toContain("0.323.0");
    expect(v?.message).toContain(`@cosmicdrift/kumiko-feature/${FRAMEWORK}`);
  });

  describe("copies under a dev-tool ancestor", () => {
    const CLI = "@cosmicdrift/kumiko-cli";
    const FEATURE = "@cosmicdrift/kumiko-feature";

    test("a nested copy only under a dev-marked package is ignored", async () => {
      const root = makeRepo({
        lock: lockOf([
          [FRAMEWORK, `${FRAMEWORK}@0.323.0`],
          [`${CLI}/${FRAMEWORK}`, `${FRAMEWORK}@0.285.0`],
        ]),
        markers: { [FRAMEWORK]: "runtime", [CLI]: "dev" },
      });
      expect((await check.run([root])).violations).toEqual([]);
    });

    test("an extra copy under a runtime feature package still fails next to the dev one", async () => {
      const root = makeRepo({
        lock: lockOf([
          [FRAMEWORK, `${FRAMEWORK}@0.323.0`],
          [`${CLI}/${FRAMEWORK}`, `${FRAMEWORK}@0.285.0`],
          [`${FEATURE}/${FRAMEWORK}`, `${FRAMEWORK}@0.300.0`],
        ]),
        markers: { [FRAMEWORK]: "runtime", [CLI]: "dev", [FEATURE]: "runtime" },
      });
      const outcome = await check.run([root]);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.message).toContain("0.300.0");
      expect(outcome.violations[0]?.message).not.toContain("0.285.0");
    });

    test("an ancestor without marker does not protect its subtree", async () => {
      const root = makeRepo({
        lock: lockOf([
          [FRAMEWORK, `${FRAMEWORK}@0.323.0`],
          [`${CLI}/${FRAMEWORK}`, `${FRAMEWORK}@0.285.0`],
        ]),
        markers: { [FRAMEWORK]: "runtime", [CLI]: null },
      });
      expect((await check.run([root])).violations).toHaveLength(1);
    });
  });

  test("flags a Kumiko-scoped package without marker", async () => {
    const root = makeRepo({
      lock: lockOf([
        ["@cosmicdriftgamestudio/thing", "@cosmicdriftgamestudio/thing@1.0.0"],
        ["a/@cosmicdriftgamestudio/thing", "@cosmicdriftgamestudio/thing@2.0.0"],
      ]),
      markers: { "@cosmicdriftgamestudio/thing": null },
    });
    const outcome = await check.run([root]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("no kumiko.runtime marker");
  });

  test("flags a package that is not installed at all (no marker found)", async () => {
    const root = makeRepo({
      lock: lockOf([
        [FRAMEWORK, `${FRAMEWORK}@1.0.0`],
        [`a/${FRAMEWORK}`, `${FRAMEWORK}@2.0.0`],
      ]),
    });
    expect((await check.run([root])).violations).toHaveLength(1);
  });

  test("flags a prod-marked package", async () => {
    const name = "@cosmicdrift/kumiko-server-runtime";
    const root = makeRepo({
      lock: lockOf([
        [name, `${name}@1.0.0`],
        [`a/${name}`, `${name}@2.0.0`],
      ]),
      markers: { [name]: "prod" },
    });
    const outcome = await check.run([root]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("prod");
  });

  test.each(["dev", "tooling", "test"])("passes a %s-marked duplicate", async (marker) => {
    const name = "@cosmicdrift/kumiko-repo-manifest";
    const root = makeRepo({
      lock: lockOf([
        [name, `${name}@1.0.0`],
        [`a/${name}`, `${name}@2.0.0`],
      ]),
      markers: { [name]: marker },
    });
    const outcome = await check.run([root]);
    expect(outcome.violations).toEqual([]);
    expect(outcome.matchedFiles).toBe(1);
  });

  test("ignores workspace: entries", async () => {
    const root = makeRepo({
      lock: lockOf([
        [FRAMEWORK, `${FRAMEWORK}@workspace:packages/framework`],
        [`a/${FRAMEWORK}`, `${FRAMEWORK}@0.285.0`],
      ]),
      markers: { [FRAMEWORK]: "runtime" },
    });
    expect((await check.run([root])).violations).toEqual([]);
  });

  test("passes a third-party duplicate without marker", async () => {
    const root = makeRepo({
      lock: lockOf([
        ["picomatch", "picomatch@2.0.0"],
        ["tinyglobby/picomatch", "picomatch@4.0.0"],
      ]),
    });
    expect((await check.run([root])).violations).toEqual([]);
  });

  test("passes a single version of a runtime package", async () => {
    const root = makeRepo({
      lock: lockOf([[FRAMEWORK, `${FRAMEWORK}@0.323.0`]]),
      markers: { [FRAMEWORK]: "runtime" },
    });
    expect((await check.run([root])).violations).toEqual([]);
  });

  test("reports an unparsable bun.lock as a violation instead of throwing", async () => {
    const root = makeRepo({ lock: "{ broken" });
    const outcome = await check.run([root]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("bun.lock could not be parsed");
    expect(outcome.matchedFiles).toBe(1);
  });

  test("is notApplicable without any bun.lock", async () => {
    const outcome = await check.run([makeRepo({})]);
    expect(outcome.notApplicable).toBe(true);
    expect(outcome.matchedFiles).toBe(0);
  });
});
