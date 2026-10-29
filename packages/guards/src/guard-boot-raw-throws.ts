#!/usr/bin/env bun
/**
 * Boot Raw Throws Guard: freezes raw `throw new Error` in boot validation per file, because new boot rules use `throw bootRuleError(RULE, { message })` with a rule table in `<validator>-rules.ts`; the guard and its baseline `.kumiko-boot-raw-throws-baseline.json` are deleted once every file is at 0.
 */

import path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
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
const GUARD_NAME = "boot-raw-throws";

const SCAN: ScanSpec = {
  scope: "source",
  kinds: ["framework"],
  extensions: ["ts"],
  frameworkWithin: [
    "packages/framework/src/engine/boot-validator/**",
    "packages/bundled-features/src/*/boot-checks.ts",
  ],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.d\.ts$)/;

export function rawErrorThrowLines(file: SourceFile): number[] {
  return file
    .getDescendantsOfKind(SyntaxKind.ThrowStatement)
    .filter((statement) => {
      const thrown = statement.getExpression();
      return (
        thrown.isKind(SyntaxKind.NewExpression) && thrown.getExpression().getText() === "Error"
      );
    })
    .map((statement) => statement.getStartLineNumber());
}

export function rawThrowCounts(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): { counts: Record<string, number>; firstLine: Record<string, number> } {
  const counts: Record<string, number> = {};
  const firstLine: Record<string, number> = {};
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const lines = rawErrorThrowLines(sf);
    const first = lines[0];
    if (first === undefined) continue;
    const file = relFromRepoRoot(sf.getFilePath(), roots);
    if (!isLocalFinding({ file })) continue;
    counts[file] = lines.length;
    firstLine[file] = first;
  }
  return { counts, firstLine };
}

const rawThrowBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-boot-raw-throws-baseline.json"),
  formatVersion: 1,
  unit: "raw throw new Error in boot validation",
  failClosed: true,
});

const REMEDIATION =
  "Declare the rule in the validator's `<validator>-rules.ts` table and throw `bootRuleError(RULES.name, { message })` instead of `new Error(...)`.";

export const guard: AstGuard = {
  name: GUARD_NAME,
  scan: SCAN,
  hint: `after fixing hits: \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\``,
  run: (files, roots = resolveRepoRoots()) => {
    const { counts, firstLine } = rawThrowCounts(files, roots);
    return {
      violations: rawThrowBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\` once.`,
        resolveLine: (file) => firstLine[file] ?? 1,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    rawThrowBaseline.write(rawThrowCounts(files, roots).counts);
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
