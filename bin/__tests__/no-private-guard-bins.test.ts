import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The private @cosmicdriftgamestudio/kumiko-guards package is no longer a devDependency. Without it,
// `bunx kumiko-<private-bin>` finds nothing locally and would pull a same-named foreign package from
// the public registry, so the only bunx target left in these files is the workspace's own `kumiko-guards`.
const repoRoot = join(import.meta.dir, "..", "..");
const PRIVATE_PACKAGE = "@cosmicdriftgamestudio/kumiko-guards";
const NON_WORKSPACE_KUMIKO_BIN = /bunx\s+kumiko-(?!guards(?![\w-]))[\w-]+/g;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("no dependency on the private guards package", () => {
  for (const source of ["bin/kumiko-legacy.ts", "scripts/check-wt.sh", "scripts/pre-push-extra.sh"]) {
    test(`${source} only runs the workspace's own kumiko-guards through bunx`, () => {
      expect(readRepoFile(source).match(NON_WORKSPACE_KUMIKO_BIN) ?? []).toEqual([]);
    });
  }

  test("package.json does not reference the private package", () => {
    expect(readRepoFile("package.json").includes(PRIVATE_PACKAGE)).toBe(false);
  });

  test("the pattern flags private bins and accepts kumiko-guards subcommands", () => {
    expect("bunx kumiko-guard-feature-changelog".match(NON_WORKSPACE_KUMIKO_BIN)).toHaveLength(1);
    expect("bunx kumiko-check-licenses".match(NON_WORKSPACE_KUMIKO_BIN)).toHaveLength(1);
    expect("bunx kumiko-guards licenses".match(NON_WORKSPACE_KUMIKO_BIN)).toBeNull();
  });
});
