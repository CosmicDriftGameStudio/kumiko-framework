import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const INCLUDE_DIRS = ["packages", "samples"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

const REPLACEMENTS: Array<[string, string]> = [
  ["vi.clearAllMocks()", "mock.restore()"],
  ["vi.useRealTimers()", "useRealTimers()"],
  ["vi.unstubAllGlobals()", ""],
  ["vi.stubGlobal(", "globalThis["],
  ["vi.fn<", "mock<"],
  ["typeof vi.fn", "typeof mock"],
  ["vi.mocked(", ""],
];

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
  let changed = false;

  // Only process files that still have vi.* patterns
  if (!content.includes("vi.")) return false;

  for (const [oldStr, newStr] of REPLACEMENTS) {
    if (content.includes(oldStr)) {
      content = content.replaceAll(oldStr, newStr);
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(filePath, content);
  }
  return changed;
}

// Main
const allFiles = INCLUDE_DIRS.flatMap((d) => collectFiles(join(ROOT, d)));
let changed = 0;

for (const file of allFiles) {
  try {
    if (processFile(file)) {
      changed++;
    }
  } catch (err) {
    console.error(`\n  Fehler in ${file}: ${err}`);
  }
}

console.log(`\nDone: ${changed} files changed`);
