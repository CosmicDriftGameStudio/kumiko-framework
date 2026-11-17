#!/usr/bin/env bun
/**
 * File Size Guard — production files above 1200 lines and test files (unit,
 * integration, e2e specs) above 1500 lines are frozen in
 * `.kumiko-file-size-baseline.json` (key = file, value = line count) and may
 * not grow; a new file above its threshold is a violation. A missing baseline file counts as an empty baseline, so every existing hit fails until it is frozen with `--write-baseline`.
 *
 * Excluded: declaration files, generated files and the translation
 * data in the locale packages' `src/strings.ts`.
 */

import path from "node:path";
import type { SourceFile } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source+tests",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**", "packages/*/e2e/**"],
  extraGlobs: [
    "e2e/**/*.{ts,tsx}",
    "packages/*/e2e/**/*.{ts,tsx}",
    "samples/apps/*/e2e/**/*.{ts,tsx}",
  ],
};

export const MAX_FILE_LINES = 1200;

export const MAX_TEST_FILE_LINES = 1500;

const ALWAYS_EXCLUDED =
  /(\.d\.(ts|tsx)$|\.generated\.(ts|tsx)$|\/generated\/|\/locale-[^/]+\/src\/strings\.ts$)/;
const TEST_FILE =
  /(\/__tests__\/|\.test\.(ts|tsx)$|\.integration\.(ts|tsx)$|\.spec\.(ts|tsx)$|\/e2e[^/]*\/)/;

const fileSizeBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-file-size-baseline.json"),
  formatVersion: 1,
  unit: "oversized file(s)",
});

function lineCountOf(text: string): number {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function oversizedFileLines(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sf of files) {
    const filePath = sf.getFilePath();
    if (ALWAYS_EXCLUDED.test(filePath)) continue;
    const limit = TEST_FILE.test(filePath) ? MAX_TEST_FILE_LINES : MAX_FILE_LINES;
    const lines = lineCountOf(sf.getFullText());
    if (lines <= limit) continue;
    counts[relFromRepoRoot(sf.getFilePath(), roots)] = lines;
  }
  return counts;
}

function localOnly(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([file]) => isLocalFinding({ file })));
}

const REMEDIATION = `Production files stay at ${MAX_FILE_LINES} lines, test files at ${MAX_TEST_FILE_LINES}: split the file by behaviour (cut along a responsibility seam), do not grow a frozen one.`;

export const guard: AstGuard = {
  name: "File Size",
  scan: SCAN,
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="File Size"`',
  run: (files, roots = resolveRepoRoots()) => {
    const counts = localOnly(oversizedFileLines(files, roots));
    return {
      violations: fileSizeBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="File Size"\` once.`,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    fileSizeBaseline.write(localOnly(oversizedFileLines(files, roots)));
  },
};

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    guard.writeBaseline?.(filesForGuard(project, guard));
    process.exit(0);
  }
  runStandalone(guard);
}
