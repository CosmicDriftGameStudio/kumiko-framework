// A fresh scaffold must pass `bun run lint` (biome check .) without rework.
// Scaffolds live in the system tmpdir: under the repo, its .gitignore would
// make Biome's VCS integration ignore every generated file.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SCAFFOLD_BIOME_VERSION, scaffoldApp } from "@cosmicdrift/kumiko-dev-server";
import { runCreate } from "../index";

const biomePackageJson = createRequire(import.meta.url).resolve("@biomejs/biome/package.json");
const repoBiomeVersion = (JSON.parse(readFileSync(biomePackageJson, "utf8")) as { version: string })
  .version;
const biomeBin = join(dirname(biomePackageJson), "bin", "biome");

const tmpRoots: string[] = [];
function makeTmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kumiko-scaffold-lint-"));
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
    expect(readFileSync(join(destination, "biome.json"), "utf8")).toContain(
      `/schemas/${SCAFFOLD_BIOME_VERSION}/schema.json`,
    );
  });
});
