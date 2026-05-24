#!/usr/bin/env bun
// Fix für Import-Gaps nach 02-vi-cleanup.
//
// Scannt jedes Test-File: welche bun:test-Symbole werden in den call-sites
// genutzt? Vergleicht mit dem from "bun:test"-Import. Ergänzt fehlende
// Namen alphabetisch sortiert.

import { Glob } from "bun";
import { resolve, relative } from "node:path";

const PROJECT_ROOT = process.argv[2] ?? process.cwd();

// Symbol → Detektor-Regex (Word-Boundary + Open-Paren oder Identifier-Usage)
const SYMBOLS: ReadonlyArray<readonly [string, RegExp]> = [
  ["mock", /\bmock\s*[(<.]/g],
  ["spyOn", /\bspyOn\s*\(/g],
  ["useFakeTimers", /\buseFakeTimers\s*\(/g],
  ["useRealTimers", /\buseRealTimers\s*\(/g],
  ["setSystemTime", /\bsetSystemTime\s*\(/g],
  ["advanceTimersByTime", /\badvanceTimersByTime\s*\(/g],
  ["jest", /\bjest\b/g],
];

const BUN_IMPORT_RE = /^import\s+\{([^}]+)\}\s+from\s+["']bun:test["']\s*;?\s*$/m;

async function fixFile(path: string): Promise<boolean> {
  const text = await Bun.file(path).text();
  const importMatch = text.match(BUN_IMPORT_RE);
  if (!importMatch) return false; // kein bun:test-Import → File nicht relevant

  const existing = importMatch[1]!
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Welche Symbole werden im Body genutzt, ABER nicht in Import-Position?
  // (Body = alles außer dem Import-Statement selbst)
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
