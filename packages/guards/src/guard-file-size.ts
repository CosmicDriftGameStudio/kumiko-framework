#!/usr/bin/env bun
/**
 * File Size Guard — production files above 1200 lines are frozen in
 * `.kumiko-file-size-baseline.json` (key = file, value = line count) and may
 * not grow; a new file above the threshold is a violation. Without a baseline
 * file (consumer repos) it only warns.
 *
 * Excluded: tests, declaration files, generated files and the translation
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
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**"],
};

export const MAX_FILE_LINES = 1200;

const EXCLUDE =
  /(__tests__|\.test\.(ts|tsx)$|\.integration\.(ts|tsx)$|\.d\.(ts|tsx)$|\.generated\.(ts|tsx)$|\/generated\/|\/locale-[^/]+\/src\/strings\.ts$)/;

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
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const lines = lineCountOf(sf.getFullText());
    if (lines <= MAX_FILE_LINES) continue;
    counts[relFromRepoRoot(sf.getFilePath(), roots)] = lines;
  }
  return counts;
}

function localOnly(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([file]) => isLocalFinding({ file })));
}

const REMEDIATION = `Split the file below ${MAX_FILE_LINES + 1} lines (cut along a responsibility seam), do not grow a frozen one.`;

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
