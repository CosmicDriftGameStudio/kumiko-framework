#!/usr/bin/env bun
// @runtime tooling
// Stages the sample/bundled-feature sources into packages/samples for
// `bun pm pack` (prepack = stage, postpack = clean).
//
// The file list comes from `git ls-files` + a whitelist because `bun pm pack`
// ships nested node_modules/ and .env files unfiltered and ignores `files`
// in nested package.json files.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const packageDir = join(repoRoot, "packages", "samples");

const STAGED_ROOTS = ["samples", "packages"] as const;
const SOURCE_PATHSPECS = [
  "samples/recipes",
  "samples/apps",
  "packages/bundled-features/package.json",
  "packages/bundled-features/src",
] as const;
const REQUIRED_SUBTREES = [
  "samples/recipes",
  "samples/apps",
  "packages/bundled-features/src",
] as const;
const REQUIRED_FILE = "packages/bundled-features/package.json";

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

export function isShippedSamplePath(path: string): boolean {
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

function clean(): void {
  for (const root of STAGED_ROOTS) {
    rmSync(join(packageDir, root), { recursive: true, force: true });
  }
}

function listTrackedSources(): string[] {
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

function stage(): void {
  clean();
  const shipped = listTrackedSources().filter(isShippedSamplePath);
  for (const path of shipped) {
    const source = join(repoRoot, path);
    // A tracked symlink passes the path whitelist but could point outside the repo.
    if (lstatSync(source).isSymbolicLink()) {
      clean();
      throw new Error(`stage-samples-package: refusing tracked symlink ${path}`);
    }
    const target = join(packageDir, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
  const missing: string[] = REQUIRED_SUBTREES.filter(
    (subtree) => countFiles(join(packageDir, subtree)) < 1,
  );
  if (!existsSync(join(packageDir, REQUIRED_FILE))) missing.push(REQUIRED_FILE);
  if (missing.length > 0) {
    clean();
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
