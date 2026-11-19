import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoRoot } from "../_lib/roots";
import { check, repoExtendsFrameworkPreset } from "../guard-biome-preset";

const dirs: string[] = [];

function repoWithBiome(biomeJson: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "biome-preset-"));
  dirs.push(dir);
  if (biomeJson !== undefined) writeFileSync(join(dir, "biome.json"), biomeJson, "utf-8");
  return dir;
}

function appRoot(absPath: string, kind: "app" | "library" = "app"): RepoRoot {
  return { name: "fixture", absPath, kind } as RepoRoot;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("biome-preset repo check", () => {
  test("passes when biome.json extends the framework preset", async () => {
    const dir = repoWithBiome('{ "extends": ["@cosmicdrift/kumiko-framework/biome"] }');
    expect(repoExtendsFrameworkPreset(dir)).toBe(true);
    const outcome = await check.run([appRoot(dir)]);
    expect(outcome.violations).toEqual([]);
  });

  test("flags an app whose biome.json has no extends", async () => {
    const dir = repoWithBiome("{}");
    const outcome = await check.run([appRoot(dir)]);
    expect(outcome.violations).toHaveLength(1);
  });

  test("flags an app without any biome config", async () => {
    const outcome = await check.run([appRoot(repoWithBiome(undefined))]);
    expect(outcome.violations).toHaveLength(1);
  });

  test("is not applicable to a library repo", async () => {
    const outcome = await check.run([appRoot(repoWithBiome("{}"), "library")]);
    expect(outcome.notApplicable).toBe(true);
    expect(outcome.violations).toEqual([]);
  });
});
