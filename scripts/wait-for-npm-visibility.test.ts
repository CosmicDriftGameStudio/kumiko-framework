import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  collectPublishablePackages,
  isLatestOnRegistry,
  waitForNpmVisibility,
} from "./wait-for-npm-visibility";

describe("isLatestOnRegistry", () => {
  test("matches when dist-tags.latest equals the expected version", () => {
    const packument = { "dist-tags": { latest: "0.236.1" } };
    expect(isLatestOnRegistry(packument, "0.236.1")).toBe(true);
  });

  // The real @cosmicdrift/kumiko-bundled-features packument from the 0.236.1
  // release (2026-09-08): `versions` already listed 0.236.1 seconds after
  // publish, but `dist-tags.latest` stayed on "0.236.0" for hours. Renovate
  // respects `latest` by default, so checking `versions` alone (the original,
  // wrong check) would have reported this package ready when it wasn't.
  test("reports false when versions contains the release but dist-tags.latest is still the previous version", () => {
    const packument = {
      versions: { "0.236.0": {}, "0.236.1": {} },
      "dist-tags": { latest: "0.236.0" },
    };
    expect(isLatestOnRegistry(packument, "0.236.1")).toBe(false);
  });

  test("returns false for an empty object without throwing", () => {
    expect(isLatestOnRegistry({}, "0.236.1")).toBe(false);
  });

  test("returns false when dist-tags is present but empty, without throwing", () => {
    expect(isLatestOnRegistry({ "dist-tags": {} }, "0.236.1")).toBe(false);
  });

  test("returns false for null without throwing", () => {
    expect(isLatestOnRegistry(null, "0.236.1")).toBe(false);
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
  test("catches up on the second poll and returns success after exactly two polls", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      const latest = calls >= 2 ? "0.236.1" : "0.236.0";
      return new Response(JSON.stringify({ "dist-tags": { latest } }), { status: 200 });
    }) as typeof fetch;

    const result = await waitForNpmVisibility(
      [{ name: "@cosmicdrift/kumiko-types", version: "0.236.1" }],
      { fetchImpl, pollIntervalMs: 1, timeoutMs: 60_000 },
    );

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(calls).toBe(2);
  });

  test("times out and names the package whose latest tag never caught up", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ "dist-tags": { latest: "0.236.0" } }), { status: 200 })) as typeof fetch;

    const result = await waitForNpmVisibility(
      [{ name: "@cosmicdrift/kumiko-bundled-features", version: "0.236.1" }],
      { fetchImpl, pollIntervalMs: 1, timeoutMs: 0 },
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      { name: "@cosmicdrift/kumiko-bundled-features", version: "0.236.1" },
    ]);
  });

  test("a network error on one package counts as not-yet-caught-up and is retried", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("network blip");
      return new Response(JSON.stringify({ "dist-tags": { latest: "0.236.1" } }), { status: 200 });
    }) as typeof fetch;

    const result = await waitForNpmVisibility(
      [{ name: "@cosmicdrift/kumiko-types", version: "0.236.1" }],
      { fetchImpl, pollIntervalMs: 1, timeoutMs: 60_000 },
    );

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
