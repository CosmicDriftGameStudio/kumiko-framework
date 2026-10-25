#!/usr/bin/env bun
// Fixes for import gaps after 02-vi-cleanup.
//
// Scans each test file: which bun:test symbols are used at the call sites?
// Compares them with the from "bun:test" import. Adds missing names sorted
// alphabetically.

import { Glob } from "bun";
import { resolve, relative } from "node:path";

const PROJECT_ROOT = process.argv[2] ?? process.cwd();

// Symbol → Detector regex (Word-Boundary + Open-Paren or Identifier-Usage)
// NO /g flag! regex.test() with /g has lastIndex state that leaks between
// calls. We want a pure boolean indicating whether the pattern matches *anywhere*.
const SYMBOLS: ReadonlyArray<readonly [string, RegExp]> = [
  ["mock", /\bmock\s*[(<.]/],
  ["spyOn", /\bspyOn\s*\(/],
  ["useFakeTimers", /\buseFakeTimers\s*\(/],
  ["useRealTimers", /\buseRealTimers\s*\(/],
  ["setSystemTime", /\bsetSystemTime\s*\(/],
  ["advanceTimersByTime", /\badvanceTimersByTime\s*\(/],
  ["jest", /\bjest\b/],
];

const BUN_IMPORT_RE = /^import\s+\{([^}]+)\}\s+from\s+["']bun:test["']\s*;?\s*$/m;

async function fixFile(path: string): Promise<boolean> {
  const text = await Bun.file(path).text();
  const importMatch = text.match(BUN_IMPORT_RE);
  if (!importMatch) return false; // no bun:test import → File not relevant

  const existing = importMatch[1]!
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Which symbols are used in the body, BUT not in import position?
  // (Body = everything except the import statement itself)
  const bodyText = text.replace(importMatch[0], "");
  const needed = new Set<string>();
  for (const [name, regex] of SYMBOLS) {
    if (regex.test(bodyText)) needed.add(name);
  }

  const missing = Array.from(needed).filter((n) => !existing.includes(n));
  if (missing.length === 0) return false;

  const next = [...existing, ...missing].sort();
  const newImport = `import { ${next.join(", ")} } from "bun:test";`;
  const updated = text.replace(importMatch[0], newImport);

  await Bun.write(path, updated);
  return true;
}

async function main(): Promise<void> {
  const EXCLUDE = ["/node_modules/", "/dist/", "/build/"];
  let touched = 0;
  let scanned = 0;

  for (const ext of ["ts", "tsx"]) {
    const glob = new Glob(`**/*.test.${ext}`);
    for await (const file of glob.scan({ cwd: PROJECT_ROOT, dot: false })) {
      const abs = resolve(PROJECT_ROOT, file);
      if (EXCLUDE.some((p) => abs.includes(p))) continue;
      scanned++;
      const changed = await fixFile(abs);
      if (changed) {
        touched++;
        console.log(`  ${relative(PROJECT_ROOT, abs)}`);
      }
    }
    const glob2 = new Glob(`**/*.integration.${ext}`);
    for await (const file of glob2.scan({ cwd: PROJECT_ROOT, dot: false })) {
      const abs = resolve(PROJECT_ROOT, file);
      if (EXCLUDE.some((p) => abs.includes(p))) continue;
      scanned++;
      const changed = await fixFile(abs);
      if (changed) {
        touched++;
        console.log(`  ${relative(PROJECT_ROOT, abs)}`);
      }
    }
  }

  console.log(`\nscanned ${scanned} files, fixed ${touched}`);
}

await main();
