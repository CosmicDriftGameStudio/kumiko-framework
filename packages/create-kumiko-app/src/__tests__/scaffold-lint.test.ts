// A fresh scaffold must pass `bun run lint` (biome check .) without rework.
// Scaffolds live in the repo's ignored .tmp-fixtures so biome.json's
// `extends: ["@cosmicdrift/kumiko-framework/biome"]` resolves through the
// workspace node_modules; the preset turns off Biome's VCS ignore file, so the
// repo's .gitignore does not hide the generated files.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { SCAFFOLD_BIOME_VERSION, scaffoldApp } from "@cosmicdrift/kumiko-dev-server";
import { runCreate } from "../index";

const biomePackageJson = createRequire(import.meta.url).resolve("@biomejs/biome/package.json");
const repoBiomeVersion = (JSON.parse(readFileSync(biomePackageJson, "utf8")) as { version: string })
  .version;
const biomeBin = join(dirname(biomePackageJson), "bin", "biome");

const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "..", "..", ".tmp-fixtures");
const tmpRoots: string[] = [];
function makeTmpRoot(): string {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const root = mkdtempSync(join(FIXTURE_ROOT, "scaffold-lint-"));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

function biomeCheck(appDir: string): { status: number | null; output: string } {
  const result = spawnSync(biomeBin, ["check", "."], { cwd: appDir, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectLintGreen(appDir: string): void {
  const { status, output } = biomeCheck(appDir);
  expect(output).toMatch(/Checked [1-9]\d* files?/);
  expect(output, output).not.toMatch(/Found \d+ (error|warning|info)/);
  expect(status).toBe(0);
}

const LONG_NAME = "a-very-long-application-name-that-keeps-going-and-going-on";
const MID_NAME = "a-moderately-long-application-name-for-wrapping";

describe("scaffold lint", () => {
  test("pinned scaffold Biome version equals the repo Biome version", () => {
    expect(SCAFFOLD_BIOME_VERSION).toBe(repoBiomeVersion);
  });

  test.each([["ab"], [MID_NAME], [LONG_NAME]])(
    "--yes featureset passes biome check (%s)",
    async (name) => {
      const cwd = makeTmpRoot();
      const code = await runCreate({ name, yes: true, cwd, log: () => {} });
      expect(code).toBe(0);
      expectLintGreen(join(cwd, name));
    },
  );

  test.each([["ab"], [MID_NAME], [LONG_NAME]])(
    "foundation featureset passes biome check (%s)",
    async (name) => {
      const cwd = makeTmpRoot();
      const { destination } = await scaffoldApp({ name, cwd });
      expectLintGreen(destination);
    },
  );

  test("scaffold writes .gitignore and pins biome exactly", async () => {
    const cwd = makeTmpRoot();
    const { destination, files } = await scaffoldApp({ name: "pin-check", cwd });
    expect(files).toContain(".gitignore");
    const pkg = JSON.parse(readFileSync(join(destination, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@biomejs/biome"]).toBe(SCAFFOLD_BIOME_VERSION);
    const preset = createRequire(import.meta.url).resolve("@cosmicdrift/kumiko-framework/biome");
    expect(readFileSync(preset, "utf8")).toContain(
      `/schemas/${SCAFFOLD_BIOME_VERSION}/schema.json`,
    );
  });
});
