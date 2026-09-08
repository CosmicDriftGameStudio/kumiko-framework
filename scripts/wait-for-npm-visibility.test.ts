import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  collectPublishablePackages,
  isVersionVisible,
  waitForNpmVisibility,
} from "./wait-for-npm-visibility";

describe("isVersionVisible", () => {
  test("finds the published version in the packument", () => {
    const packument = { versions: { "0.236.1": {}, "0.236.0": {} } };
    expect(isVersionVisible(packument, "0.236.1")).toBe(true);
  });

  // The exact reproduced fw#2644 failure: bundled-features@0.236.1 was published
  // but the registry's CDN still only served the packument up to 0.236.0.
  test("reports the stale-CDN case: only the previous version is present", () => {
    const packument = { versions: { "0.236.0": {} } };
    expect(isVersionVisible(packument, "0.236.1")).toBe(false);
  });

  test("returns false for an empty object without throwing", () => {
    expect(isVersionVisible({}, "0.236.1")).toBe(false);
  });

  test("returns false for null without throwing", () => {
    expect(isVersionVisible(null, "0.236.1")).toBe(false);
  });

  test("returns false for a packument missing the versions field without throwing", () => {
    expect(isVersionVisible({ name: "@cosmicdrift/kumiko-types" }, "0.236.1")).toBe(false);
  });
});

describe("collectPublishablePackages", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makePackagesDir(pkgs: Array<Record<string, unknown>>): string {
    const dir = mkdtempSync(join(tmpdir(), "wait-for-npm-visibility-"));
    tempDirs.push(dir);
    pkgs.forEach((pkg, i) => {
      const pkgDir = join(dir, `pkg-${i}`);
      mkdirSync(pkgDir);
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg));
    });
    return dir;
  }

  test("collects name and version from every non-private package", () => {
    const dir = makePackagesDir([
      { name: "@cosmicdrift/kumiko-framework", version: "0.236.1" },
      { name: "@cosmicdrift/kumiko-types", version: "0.236.1" },
    ]);
    expect(collectPublishablePackages(dir)).toEqual([
      { name: "@cosmicdrift/kumiko-framework", version: "0.236.1" },
      { name: "@cosmicdrift/kumiko-types", version: "0.236.1" },
    ]);
  });

  test("skips packages marked private", () => {
    const dir = makePackagesDir([
      { name: "@cosmicdrift/kumiko-framework", version: "0.236.1" },
      { name: "@cosmicdrift/kumiko-samples", version: "0.236.1", private: true },
    ]);
    expect(collectPublishablePackages(dir)).toEqual([
      { name: "@cosmicdrift/kumiko-framework", version: "0.236.1" },
    ]);
  });
});

describe("waitForNpmVisibility", () => {
  test("becomes visible on the second poll and returns success after exactly two polls", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      const versions = calls >= 2 ? { "0.236.1": {} } : {};
      return new Response(JSON.stringify({ versions }), { status: 200 });
    }) as typeof fetch;

    const result = await waitForNpmVisibility(
      [{ name: "@cosmicdrift/kumiko-types", version: "0.236.1" }],
      { fetchImpl, pollIntervalMs: 1, timeoutMs: 60_000 },
    );

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(calls).toBe(2);
  });

  test("times out and names the package that never became visible", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ versions: {} }), { status: 200 })) as typeof fetch;

    const result = await waitForNpmVisibility(
      [{ name: "@cosmicdrift/kumiko-bundled-features", version: "0.236.1" }],
      { fetchImpl, pollIntervalMs: 1, timeoutMs: 0 },
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      { name: "@cosmicdrift/kumiko-bundled-features", version: "0.236.1" },
    ]);
  });

  test("a network error on one package counts as not-yet-visible and is retried", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("network blip");
      return new Response(JSON.stringify({ versions: { "0.236.1": {} } }), { status: 200 });
    }) as typeof fetch;

    const result = await waitForNpmVisibility(
      [{ name: "@cosmicdrift/kumiko-types", version: "0.236.1" }],
      { fetchImpl, pollIntervalMs: 1, timeoutMs: 60_000 },
    );

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
