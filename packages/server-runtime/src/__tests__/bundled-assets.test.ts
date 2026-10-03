import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProdBundle } from "../build-prod-bundle.js";
import { readBundledAsset, resolveBundledAsset } from "../bundled-assets.js";

const BYTES = new Uint8Array([0, 1, 2, 254, 255]);

describe("readBundledAsset / resolveBundledAsset", () => {
  let appDir = "";

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), "kumiko-bundled-assets-"));
    await mkdir(join(appDir, "fonts"), { recursive: true });
    await mkdir(join(appDir, "public"), { recursive: true });
    await writeFile(join(appDir, "public/index.html"), "<!doctype html>");
    await writeFile(join(appDir, "fonts/inter-bold.ttf"), BYTES);
    await writeFile(
      join(appDir, "package.json"),
      JSON.stringify({
        name: "assets-app",
        kumiko: { assets: [{ name: "inter-bold.ttf", source: "fonts/inter-bold.ttf" }] },
      }),
    );
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  test("dev (declared source) and a built dist return the same bytes", async () => {
    const fromDev = await readBundledAsset("inter-bold.ttf", { cwd: appDir });
    expect(resolveBundledAsset("inter-bold.ttf", { cwd: appDir })).toBe(
      join(appDir, "fonts/inter-bold.ttf"),
    );

    await buildProdBundle({ cwd: appDir, stylesheet: false });
    // Prod ships without the source tree: the dist copy alone must serve the read.
    await rm(join(appDir, "fonts"), { recursive: true });
    const fromDist = await readBundledAsset("inter-bold.ttf", { cwd: appDir });

    expect(resolveBundledAsset("inter-bold.ttf", { cwd: appDir })).toContain("dist");
    expect([...fromDev]).toEqual([...BYTES]);
    expect([...fromDist]).toEqual([...fromDev]);
  });

  test("rejects names with a slash, '..', an empty name and undeclared names", async () => {
    for (const name of ["a/inter-bold.ttf", "../package.json", "..", "", "a..b.ttf", ".env"]) {
      await expect(readBundledAsset(name, { cwd: appDir })).rejects.toThrow(/invalid asset name/);
    }
    await expect(readBundledAsset("undeclared.ttf", { cwd: appDir })).rejects.toThrow(
      /not declared/,
    );
  });

  test("a dev source escaping the package dir is rejected", async () => {
    await writeFile(
      join(appDir, "package.json"),
      JSON.stringify({
        name: "assets-app",
        kumiko: { assets: [{ name: "x.ttf", source: "../outside-asset.ttf" }] },
      }),
    );
    await expect(readBundledAsset("x.ttf", { cwd: appDir })).rejects.toThrow(
      /escapes the package dir/,
    );
  });

  test("a declared asset whose source file is gone throws", async () => {
    await rm(join(appDir, "fonts"), { recursive: true });
    await expect(readBundledAsset("inter-bold.ttf", { cwd: appDir })).rejects.toThrow(
      /source of "inter-bold\.ttf" not found/,
    );
  });
});
