import { lstatSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";

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

// git check-ignore exits 0 when it printed ignored paths and 1 when none is ignored. Any other code
// (128: outside a repository, or one path in a submodule fails the whole batch) cannot filter the batch.
const GIT_CHECK_IGNORE_SOME_IGNORED = 0;
const GIT_CHECK_IGNORE_NONE_IGNORED = 1;

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
  const result = runGitCheckIgnore(cwd, files);
  if (result === undefined || result.exitCode === GIT_CHECK_IGNORE_NONE_IGNORED) return files;
  if (result.exitCode !== GIT_CHECK_IGNORE_SOME_IGNORED) {
    if (!isInsideWorkTree(cwd)) return files;
    return files.filter((file) => !isIgnoredByOwnRepository(file));
  }
  const ignored = new Set(result.stdout.toString().split("\0"));
  return files.filter((file) => !ignored.has(file));
}

function isInsideWorkTree(cwd: string): boolean {
  return (
    Bun.spawnSync({
      cmd: ["git", "rev-parse", "--is-inside-work-tree"],
      cwd,
      env: envWithoutGitRepositoryOverrides(),
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  );
}

// The batch failed inside a repository, so each file is asked from its own directory: a file inside a submodule or
// embedded checkout then answers from that repository's .gitignore instead of dropping the filter
// for every file under the root.
function isIgnoredByOwnRepository(file: string): boolean {
  const result = runGitCheckIgnore(dirname(file), [file]);
  return result?.exitCode === GIT_CHECK_IGNORE_SOME_IGNORED;
}

function runGitCheckIgnore(cwd: string, files: readonly string[]) {
  try {
    return Bun.spawnSync({
      cmd: ["git", "check-ignore", "--stdin", "-z"],
      cwd,
      env: envWithoutGitRepositoryOverrides(),
      stdin: Buffer.from(`${files.join("\0")}\0`),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    // Build images such as the customer-app builder ship without git; like outside a repository,
    // there is no .gitignore to honour then.
    if (errorCodeOf(error) === "ENOENT") return undefined;
    throw error;
  }
}
