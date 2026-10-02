import { lstatSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const BUILD_AND_VENDOR_DIR_NAMES: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  ".next",
  ".git",
];

export interface CollectSourceFilesOptions {
  readonly isMigratableFile: (name: string) => boolean;
  readonly extraSkippedDirNames?: readonly string[];
}

export function collectSourceFiles(
  paths: readonly string[],
  options: CollectSourceFilesOptions,
): string[] {
  const skippedDirNames = new Set([
    ...BUILD_AND_VENDOR_DIR_NAMES,
    ...(options.extraSkippedDirNames ?? []),
  ]);

  function walkDir(dir: string, out: string[]): void {
    for (const name of readdirSync(dir)) {
      if (skippedDirNames.has(name)) continue;
      const full = join(dir, name);
      const stat = lstatSync(full);
      // Symlinks can point back at a parent directory (workspace links) and loop forever.
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walkDir(full, out);
        continue;
      }
      if (options.isMigratableFile(name)) out.push(full);
    }
  }

  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (statSync(abs).isDirectory()) walkDir(abs, files);
    else if (options.isMigratableFile(abs)) files.push(abs);
  }
  return files;
}
