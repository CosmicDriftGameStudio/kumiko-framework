import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const INCLUDE_DIRS = ["packages", "samples"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

const VI_TO_BUN: Record<string, string> = {
  "vi.fn(": "mock(",
  "vi.spyOn": "spyOn",
  "vi.useFakeTimers(": "useFakeTimers(",
  "vi.setSystemTime(": "setSystemTime(",
  "vi.advanceTimersByTime(": "advanceTimersByTime(",
  "vi.restoreAllMocks(": "mock.restore(",
  "vi.hoisted(": "", // handled separately — no direct replacement
};

const IMPORTED_SYMBOLS_FROM_VI: Record<string, RegExp> = {
  mock: /vi\.fn\b/,
  spyOn: /vi\.spyOn\b/,
  useFakeTimers: /vi\.useFakeTimers\b/,
  setSystemTime: /vi\.setSystemTime\b/,
  advanceTimersByTime: /vi\.advanceTimersByTime\b/,
};

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...collectFiles(full));
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function processFile(filePath: string): boolean {
  let content = readFileSync(filePath, "utf-8");
  if (!content.includes('from "vitest"') && !content.includes("from 'vitest'")) {
    return false;
  }

  // 1) Replace vi.*() calls
  for (const [viPattern, bunFn] of Object.entries(VI_TO_BUN)) {
    if (content.includes(viPattern)) {
      content = content.replaceAll(viPattern, bunFn);
    }
  }

  // 2) Replace import
  const vitestImportRE =
    /import\s*\{([^}]+)\}\s*from\s+["']vitest["']/g;
  content = content.replace(vitestImportRE, (_match, namedBlock: string) => {
    const names = namedBlock.split(",").map((s) => s.trim()).filter(Boolean);

    // Detect if `vi` is imported — if so, determine what replaces it
    const hadVi = names.includes("vi");
    const others = names.filter((n) => n !== "vi");

    // Determine which bun:test symbols to add based on content
    const needed: string[] = [];
    if (hadVi) {
      for (const [symbol, pattern] of Object.entries(IMPORTED_SYMBOLS_FROM_VI)) {
        if (pattern.test(content) && !others.includes(symbol)) {
          needed.push(symbol);
        }
      }
    }

    const allNames = [...others, ...needed];
    return `import { ${allNames.join(", ")} } from "bun:test"`;
  });

  // 3) Handle `vi.hoisted(` — must be removed entirely (manual check or separate script)
  if (content.includes("vi.hoisted(")) {
    console.warn(`  ⚠️  ${relative(ROOT, filePath)}: vi.hoisted() — manuell prüfen`);
  }

  // 4) Handle `vi.mock(` — separate script
  if (content.includes("vi.mock(")) {
    console.warn(`  ⚠️  ${relative(ROOT, filePath)}: vi.mock() — manuell prüfen (script 03)`);
  }

  writeFileSync(filePath, content);
  return true;
}

// Main
const allFiles = INCLUDE_DIRS.flatMap((d) => collectFiles(join(ROOT, d)));
let changed = 0;
let skipped = 0;

for (const file of allFiles) {
  try {
    if (processFile(file)) {
      changed++;
      process.stdout.write(".");
    } else {
      skipped++;
    }
  } catch (err) {
    console.error(`\n  Fehler in ${file}: ${err}`);
  }
}

console.log(`\n\nDone: ${changed} files changed, ${skipped} skipped`);
