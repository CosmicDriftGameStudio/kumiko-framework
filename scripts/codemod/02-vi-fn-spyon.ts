#!/usr/bin/env bun
// Codemod 02: vi.fn / vi.spyOn / vi.useFakeTimers / vi.setSystemTime / vi.restoreAllMocks
//
// Regex-Codemod. Type-Arguments bleiben erhalten weil sie zwischen Name
// und ( stehen (`vi.fn<T>(...)` → `mock<T>(...)`).
//
// Transforms:
//   vi.fn(            → mock(
//   vi.fn<            → mock<
//   vi.spyOn(         → spyOn(
//   vi.useFakeTimers( → useFakeTimers(
//   vi.setSystemTime( → setSystemTime(
//   vi.advanceTimersByTime( → advanceTimersByTime(
//   vi.restoreAllMocks( → mock.restore(
//
// HINWEIS: `vi.mock(` wird NICHT hier behandelt — siehe 03-vi-mock.ts
// (semantik-bewusst wegen Hoisting).

import { Glob } from "bun";
import { resolve, relative } from "node:path";

const PROJECT_ROOT = process.argv[2] ?? process.cwd();

const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bvi\.fn(\b)/g, "mock$1"],
  [/\bvi\.spyOn\(/g, "spyOn("],
  [/\bvi\.useFakeTimers\(/g, "useFakeTimers("],
  [/\bvi\.useRealTimers\(/g, "useRealTimers("],
  [/\bvi\.setSystemTime\(/g, "setSystemTime("],
  [/\bvi\.advanceTimersByTime\(/g, "advanceTimersByTime("],
  [/\bvi\.advanceTimersByTimeAsync\(/g, "advanceTimersByTimeAsync("],
  [/\bvi\.runAllTimers\(/g, "runAllTimers("],
  [/\bvi\.restoreAllMocks\(/g, "mock.restore("],
  [/\bvi\.clearAllMocks\(/g, "mock.clearAll("],
  [/\bvi\.resetAllMocks\(/g, "mock.restore("],
];

// Patterns die NICHT von dieser Codemod ersetzt werden (gehen in 03)
const SKIP_PATTERNS: ReadonlyArray<RegExp> = [
  /\bvi\.mock\(/, // 03 handles this
  /\bvi\.hoisted\(/, // manual review
  /\bvi\.doMock\(/, // rare, manual
  /\bvi\.unmock\(/, // rare, manual
  /\bvi\.resetModules\(/, // rare, manual
  /\bvi\.importActual\(/, // 03 with vi.mock
  /\bvi\.importMock\(/, // 03 with vi.mock
];

const globs = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.integration.ts",
  "**/test-utils.ts",
  "**/test-utils.tsx",
];

const EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/build/**"];

async function* walkFiles(): AsyncGenerator<string> {
  for (const pattern of globs) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: PROJECT_ROOT, dot: false })) {
      const abs = resolve(PROJECT_ROOT, file);
      if (EXCLUDE.some((ex) => abs.match(ex.replace(/\*\*/g, ".*")))) continue;
      yield abs;
    }
  }
}

async function transformFile(path: string): Promise<{ changed: boolean; skipped: string[] }> {
  const original = await Bun.file(path).text();
  let next = original;

  for (const [pattern, replacement] of REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  const changed = next !== original;
  if (changed) await Bun.write(path, next);

  // Patterns die nicht hier behandelt werden — zur Info loggen
  const skipped: string[] = [];
  for (const skipPattern of SKIP_PATTERNS) {
    const matches = next.match(new RegExp(skipPattern.source, "g"));
    if (matches) skipped.push(`${skipPattern.source}: ${matches.length}×`);
  }

  return { changed, skipped };
}

async function main(): Promise<void> {
  console.log(`[codemod 02-vi-fn-spyon] project: ${PROJECT_ROOT}`);
  let touched = 0;
  const skippedReport: Array<{ path: string; skipped: string[] }> = [];

  for await (const file of walkFiles()) {
    const { changed, skipped } = await transformFile(file);
    if (changed) touched++;
    if (skipped.length) skippedReport.push({ path: relative(PROJECT_ROOT, file), skipped });
  }

  console.log(`[codemod 02-vi-fn-spyon] transformed ${touched} files`);

  if (skippedReport.length) {
    console.log(`[codemod 02-vi-fn-spyon] files with un-migrated patterns (codemod 03 / manual review):`);
    for (const { path, skipped } of skippedReport) {
      console.log(`  ${path}: ${skipped.join(", ")}`);
    }
  }

  // Idempotenz-Check: nach 2× Lauf darf nichts mehr changen
  // (Test im CI manuell durch zweimaligen Aufruf)
}

await main();
