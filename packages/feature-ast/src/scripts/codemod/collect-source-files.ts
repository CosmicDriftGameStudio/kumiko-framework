import { lstatSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const BUILD_AND_VENDOR_DIR_NAMES: readonly string[] = [
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
    const found: string[] = [];
    const isDirectory = statSync(abs).isDirectory();
    if (isDirectory) walkDir(abs, found);
    else if (options.isMigratableFile(abs)) found.push(abs);
    files.push(...withoutGitIgnored(isDirectory ? abs : dirname(abs), found));
  }
  return files;
}

// git check-ignore exits 0 when it printed ignored paths, 1 when none is ignored and 128 outside a
// repository; only 0 filters anything.
const GIT_CHECK_IGNORE_SOME_IGNORED = 0;

// A git hook exports GIT_DIR and friends, and git prefers them over cwd: inherited, check-ignore
// would ask the hook's repository about paths outside it.
export function envWithoutGitRepositoryOverrides(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => !entry[0].startsWith("GIT_") && entry[1] !== undefined,
    ),
  );
}

// Generated output, worktrees and local scratch dirs are usually only excluded through .gitignore;
// a codemod must not rewrite them.
function withoutGitIgnored(cwd: string, files: readonly string[]): readonly string[] {
  if (files.length === 0) return files;
  const result = Bun.spawnSync({
    cmd: ["git", "check-ignore", "--stdin", "-z"],
    cwd,
    env: envWithoutGitRepositoryOverrides(),
    stdin: Buffer.from(`${files.join("\0")}\0`),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== GIT_CHECK_IGNORE_SOME_IGNORED) return files;
  const ignored = new Set(result.stdout.toString().split("\0"));
  return files.filter((file) => !ignored.has(file));
}
