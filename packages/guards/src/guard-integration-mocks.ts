#!/usr/bin/env bun
/**
 * Integration-Mocks Check — integration tests run against the real stack, so mock calls (`mock(`, `spyOn(`, `mock.module`, `vi.*`, `jest.*`) in `*.integration.test.ts` / `*.integration.ts` are frozen per file in `.kumiko-integration-mocks-baseline.json` and may not grow. A missing baseline file counts as an empty baseline, so every existing hit fails until it is frozen with `--write-baseline`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  baselineRatchet,
  type RepoCheck,
  reportResults,
  runRepoChecks,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { scanRoots } from "./_lib/scan-scope";

// Member calls like `ctx.mock(` / `foo.spyOn(` must not match: the lookbehind keeps only the bun:test top-level imports.
const MOCK_CALL_PATTERN =
  /\b(?:vi\.(?:mock|fn|spyOn)|jest\.(?:mock|fn|spyOn)|mock\.module|(?<![.\w])(?:mock|spyOn))\s*\(/g;

export function countMockCalls(content: string): number {
  return content.match(MOCK_CALL_PATTERN)?.length ?? 0;
}

const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts"],
  extraGlobs: [
    "samples/apps/*/src/**/*.integration.test.ts",
    "samples/apps/*/src/**/*.integration.ts",
  ],
};

const isIntegrationTestFile = (file: string) =>
  file.endsWith(".integration.test.ts") || file.endsWith(".integration.ts");

const CHECK_NAME = "guard-integration-mocks";
const WRITE_BASELINE_COMMAND = `kumiko-guards checks --write-baseline --guard=${CHECK_NAME}`;

const REMEDIATION = `New or grown mock usage in an integration test. Move the mocked case into a *.test.ts unit test, or freeze a reviewed exception with \`${WRITE_BASELINE_COMMAND}\`.`;

function ratchetFor(root: RepoRoot) {
  return baselineRatchet({
    file: path.join(root.absPath, ".kumiko-integration-mocks-baseline.json"),
    formatVersion: 1,
    unit: "integration-test mock call(s)",
  });
}

type RootCounts = {
  readonly root: RepoRoot;
  readonly counts: Record<string, number>;
  readonly scannedFiles: number;
};

function countsPerRoot(roots: readonly RepoRoot[]): RootCounts[] {
  return scanRoots(SCAN, roots).map(({ root, files }) => {
    const counts: Record<string, number> = {};
    const integrationFiles = files.filter(isIntegrationTestFile);
    for (const file of integrationFiles) {
      const calls = countMockCalls(readFileSync(file, "utf-8"));
      if (calls > 0) counts[path.relative(root.absPath, file).split(path.sep).join("/")] = calls;
    }
    return { root, counts, scannedFiles: integrationFiles.length };
  });
}

export const check: RepoCheck = {
  name: CHECK_NAME,
  hint: `Integration tests use the real stack; assert on real effects instead of mocks. A reviewed exception is frozen with \`${WRITE_BASELINE_COMMAND}\`.`,
  async run(roots) {
    const perRoot = countsPerRoot(roots);
    const matchedFiles = perRoot.reduce((sum, entry) => sum + entry.scannedFiles, 0);
    const violations = perRoot.flatMap(({ root, counts }) =>
      ratchetFor(root).check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`${WRITE_BASELINE_COMMAND}\` once.`,
      }),
    );
    return { violations, matchedFiles, notApplicable: matchedFiles === 0 };
  },
  async writeBaseline(roots) {
    for (const { root, counts } of countsPerRoot(roots)) ratchetFor(root).write(counts);
  },
};

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    await check.writeBaseline?.(resolveRepoRoots());
    process.exit(0);
  }
  const failed = reportResults(await runRepoChecks([check], resolveRepoRoots()));
  process.exit(failed > 0 ? 1 : 0);
}
