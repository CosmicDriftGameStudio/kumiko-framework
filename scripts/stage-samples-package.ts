#!/usr/bin/env bun
// @runtime tooling
// Stages the sample/bundled-feature sources into packages/samples for
// `bun pm pack` (prepack = stage, postpack = clean).
//
// The file list comes from `git ls-files` + a whitelist because `bun pm pack`
// ships nested node_modules/ and .env files unfiltered and ignores `files`
// in nested package.json files.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const defaultRepoRoot = resolve(import.meta.dir, "..");

export type StagePaths = { readonly repoRoot: string; readonly packageDir: string };

const defaultPaths: StagePaths = {
  repoRoot: defaultRepoRoot,
  packageDir: join(defaultRepoRoot, "packages", "samples"),
};

// Single source of truth for the published layout. Each entry is a repo-relative
// path that also lives at the same relative path inside packages/samples. The
// repo checks in relative symlinks for them so the workspace link
// (node_modules/@cosmicdrift/kumiko-samples) shows the published layout;
// `stage` swaps them for filtered real copies, `clean` restores the symlinks.
const SHIPPED_ENTRIES = [
  { path: "samples/recipes", kind: "dir" },
  { path: "samples/apps", kind: "dir" },
  { path: "packages/bundled-features/package.json", kind: "file" },
  { path: "packages/bundled-features/src", kind: "dir" },
] as const;
const STAGED_ROOTS = ["samples", "packages"] as const;
const SOURCE_PATHSPECS = SHIPPED_ENTRIES.map((entry) => entry.path);

const SHIPPED_EXTENSIONS = [".ts", ".tsx", ".json", ".md"] as const;
const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set([
  "__tests__",
  "__snapshots__",
  "e2e",
  "node_modules",
  "test-results",
  "coverage",
  "dist",
]);
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

export function isShippedSamplePath(path: string, packageDir = defaultPaths.packageDir): boolean {
  if (path === "" || isAbsolute(path)) return false;
  const segments = path.split("/");
  if (segments.includes("..")) return false;
  if (segments.some((segment) => segment === "" || segment.startsWith("."))) return false;
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  if (TEST_FILE_PATTERN.test(path)) return false;
  if (!SHIPPED_EXTENSIONS.some((extension) => path.endsWith(extension))) return false;
  const target = resolve(packageDir, path);
  return target.startsWith(packageDir + sep);
}

function removeStaged({ packageDir }: StagePaths): void {
  for (const root of STAGED_ROOTS) {
    rmSync(join(packageDir, root), { recursive: true, force: true });
  }
}

function restoreSymlinks({ repoRoot, packageDir }: StagePaths): void {
  for (const { path } of SHIPPED_ENTRIES) {
    const link = join(packageDir, path);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(relative(dirname(link), join(repoRoot, path)), link);
  }
}

export function clean(paths: StagePaths = defaultPaths): void {
  removeStaged(paths);
  restoreSymlinks(paths);
}

function listTrackedSources(repoRoot: string): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--", ...SOURCE_PATHSPECS], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed (${result.exitCode}): ${result.stderr.toString()}`);
  }
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path !== "");
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  ).length;
}

export function stage(paths: StagePaths = defaultPaths): void {
  const { repoRoot, packageDir } = paths;
  removeStaged(paths);
  const shipped = listTrackedSources(repoRoot).filter((path) =>
    isShippedSamplePath(path, packageDir),
  );
  for (const path of shipped) {
    const source = join(repoRoot, path);
    // A tracked symlink passes the path whitelist but could point outside the repo.
    if (lstatSync(source).isSymbolicLink()) {
      clean(paths);
      throw new Error(`stage-samples-package: refusing tracked symlink ${path}`);
    }
    const target = join(packageDir, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
  const missing: string[] = SHIPPED_ENTRIES.filter(({ path, kind }) =>
    kind === "dir" ? countFiles(join(packageDir, path)) < 1 : !existsSync(join(packageDir, path)),
  ).map(({ path }) => path);
  if (missing.length > 0) {
    clean(paths);
    throw new Error(`stage-samples-package: nothing staged for ${missing.join(", ")}`);
  }
  console.error(`stage-samples-package: staged ${shipped.length} files`);
}

if (import.meta.main) {
  const mode = process.argv[2];
  try {
    if (mode === "stage") stage();
    else if (mode === "clean") clean();
    else throw new Error("usage: stage-samples-package.ts <stage|clean>");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
