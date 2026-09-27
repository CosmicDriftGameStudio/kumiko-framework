// bun's --parallel workers skip bunfig's coveragePathIgnorePatterns (bun 1.4.0);
// these pin the re-enforcing parse + glob semantics against the real bunfig.ci.toml.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { isIgnoredCoverageFile, readCoverageIgnorePatterns } from "../coverage-ignore";

const BUNFIG_CI_PATH = join(import.meta.dir, "..", "..", "bunfig.ci.toml");

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

describe("readCoverageIgnorePatterns", () => {
  test("reads the real bunfig.ci.toml patterns", async () => {
    const patterns = await readCoverageIgnorePatterns(BUNFIG_CI_PATH);
    expect(patterns).toEqual([
      "**/scripts/**",
      "**/bin/**",
      "**/test-setup/**",
      "integration.guard.ts",
    ]);
  });

  test("throws when [test].coveragePathIgnorePatterns is missing", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kumiko-coverage-ignore-"));
    const path = join(tmpDir, "bunfig.toml");
    writeFileSync(path, "[test]\ncoverage = true\n");

    await expect(readCoverageIgnorePatterns(path)).rejects.toThrow(
      "coveragePathIgnorePatterns is missing or not a string[]",
    );
  });
});

describe("isIgnoredCoverageFile", () => {
  const patterns = ["**/scripts/**", "**/bin/**", "**/test-setup/**", "integration.guard.ts"];

  test.each([
    "bin/commands/add.ts",
    "scripts/check-app-tsc.ts",
    "packages/framework/src/scripts/codemod/migrate-db-raw.ts",
    "test-setup/app-define-resolver.ts",
    "integration.guard.ts",
    "samples/apps/use-all-bundled/scripts/gen-sample-index.ts",
  ])("ignores %s", (path) => {
    expect(isIgnoredCoverageFile(path, patterns)).toBe(true);
  });

  test.each([
    "packages/framework/src/engine/registry.ts",
    "packages/testing/src/integration-runner.ts",
  ])(
    "keeps %s",
    (path) => {
      expect(isIgnoredCoverageFile(path, patterns)).toBe(false);
    },
  );
});
