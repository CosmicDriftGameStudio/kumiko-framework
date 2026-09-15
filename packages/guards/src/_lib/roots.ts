/**
 * Single-repo resolution for guards.
 *
 * Unlike the infra multi-repo guard runner (which scans a declared set of
 * sibling checkouts), this public package scans exactly ONE repo: the one
 * `cwd` sits in. `resolveRepoRoots()` returns either an empty array (no
 * package.json with a kumiko.json/src layout above `cwd`) or a single-element
 * array for the local repo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type LoadedRepoManifest,
  loadRepoManifest,
  REPO_MANIFEST_FILE,
  type RepoManifest,
  RepoManifestError,
  type RepoManifestSource,
} from "@cosmicdrift/kumiko-repo-manifest";

export type { RepoKind } from "@cosmicdrift/kumiko-repo-manifest";

import type { RepoKind } from "@cosmicdrift/kumiko-repo-manifest";

export type RepoRoot = {
  /** Repo identifier — the package.json `name`. */
  readonly name: string;
  /** Absolute path to the repo root. */
  readonly absPath: string;
  /** Manifest role (framework|library|app) — same as manifest.kind. */
  readonly kind: RepoKind;
  readonly manifest: RepoManifest;
  readonly manifestSource: RepoManifestSource;
};

const warnedDerivedFallbacks = new Set<string>();

function warnDerivedFallbackOnce(message: string): void {
  if (warnedDerivedFallbacks.has(message)) return;
  warnedDerivedFallbacks.add(message);
  console.error(message);
}

const manifestCache = new Map<string, LoadedRepoManifest | undefined>();

/**
 * Loads (or derives) the repo manifest at `dir`, undefined when `dir` is not
 * a scan root at all — no kumiko.json AND no derivable packages/*\/src or src/
 * layout. A present-but-invalid kumiko.json still throws (fail loud); only the
 * "nothing to derive from" case is swallowed here.
 */
function manifestAt(dir: string): LoadedRepoManifest | undefined {
  const abs = resolve(dir);
  if (manifestCache.has(abs)) return manifestCache.get(abs);
  const fileExists = existsSync(join(abs, REPO_MANIFEST_FILE));
  let result: LoadedRepoManifest | undefined;
  if (fileExists) {
    result = loadRepoManifest(abs, { warn: warnDerivedFallbackOnce });
  } else {
    try {
      result = loadRepoManifest(abs, { warn: warnDerivedFallbackOnce });
    } catch (e) {
      if (!(e instanceof RepoManifestError)) throw e;
      result = undefined;
    }
  }
  manifestCache.set(abs, result);
  return result;
}

/**
 * Spawned git calls get an allowlisted environment, never `...process.env`.
 * A caller running as a pre-push hook would otherwise inherit `GIT_DIR`/
 * `GIT_WORK_TREE` from git, which git prefers over `cwd` — so an inherited
 * environment would answer for the hook's repo instead of the path being
 * asked about. `HOME` stays in, so the global config is still read.
 */
const GIT_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME"] as const;

function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of GIT_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function git(from: string, args: readonly string[]): string | undefined {
  if (!existsSync(from)) return undefined;
  try {
    const out = execFileSync("git", [...args], {
      cwd: from,
      env: gitEnv(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

const toplevelCache = new Map<string, string | undefined>();

/**
 * The git toplevel of `cwd`, spelled via `cwd`'s own ancestors: git answers
 * with the realpath (macOS `/private/var/…`), and callers compare against the
 * path they passed in.
 */
function gitToplevelOf(cwd: string): string | undefined {
  if (toplevelCache.has(cwd)) return toplevelCache.get(cwd);
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  let spelled: string | undefined;
  if (toplevel !== undefined && existsSync(toplevel)) {
    const target = realpathSync(toplevel);
    spelled = toplevel;
    for (let curr = cwd; ; curr = dirname(curr)) {
      if (existsSync(curr) && realpathSync(curr) === target) {
        spelled = curr;
        break;
      }
      if (dirname(curr) === curr) break;
    }
  }
  toplevelCache.set(cwd, spelled);
  return spelled;
}

function rootFrom(name: string, dir: string, loaded: LoadedRepoManifest): RepoRoot {
  return {
    name,
    absPath: dir,
    kind: loaded.manifest.kind,
    manifest: loaded.manifest,
    manifestSource: loaded.source,
  };
}

/**
 * The manifest for `dir` as a scan root: a `kumiko.json` file always wins; a
 * derived manifest (no file) counts only with a repo marker present, so a
 * nested package without its own repo marker cannot claim to be the scan
 * root.
 */
function manifestRootAt(dir: string): LoadedRepoManifest | undefined {
  const loaded = manifestAt(dir);
  if (loaded === undefined || loaded.source === "file") return loaded;
  const hasRepoMarker = existsSync(join(dir, ".git")) || existsSync(join(dir, "bun.lock"));
  return hasRepoMarker ? loaded : undefined;
}

/** Classifies `dir` as a repo root by its package.json plus its manifest. */
function repoAt(dir: string): RepoRoot | undefined {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return undefined;
  }
  if (typeof pkg !== "object" || pkg === null || !("name" in pkg)) {
    return undefined;
  }
  const name = pkg.name;
  if (typeof name !== "string") return undefined;
  const loaded = manifestRootAt(dir);
  return loaded ? rootFrom(name, dir, loaded) : undefined;
}

function isDerivedAppFallback(root: RepoRoot): boolean {
  return root.manifestSource === "derived" && root.kind === "app";
}

/**
 * The repository `cwd` belongs to.
 *
 * Git first: `rev-parse --show-toplevel` is the checkout root from any
 * subdirectory, package or worktree, independent of folder names. The
 * package.json walk remains for non-git trees; there a derived-manifest "app"
 * candidate (no kumiko.json, just a bare `src/` layout) is only a fallback, so
 * a repo further up with its own manifest or explicit kind still wins over its
 * nested unregistered packages.
 */
export function findLocalRepo(cwd: string = process.cwd()): RepoRoot | undefined {
  const start = resolve(cwd);
  const toplevel = gitToplevelOf(start);
  const fromGit = toplevel !== undefined ? repoAt(toplevel) : undefined;
  if (fromGit) return fromGit;
  let fallback: RepoRoot | undefined;
  for (let curr = start; curr !== dirname(curr); curr = dirname(curr)) {
    const candidate = repoAt(curr);
    if (candidate === undefined) continue;
    if (!isDerivedAppFallback(candidate)) return candidate;
    fallback = candidate;
  }
  return fallback;
}

/** Where a scanned root came from — printed by `run-guards.ts --explain`. */
export type RootSource = "local";

export type ExplainedRoot = {
  readonly root: RepoRoot;
  readonly source: RootSource;
};

export type RootResolution = {
  readonly roots: readonly ExplainedRoot[];
};

/**
 * Resolves the repo to scan: empty when `cwd` sits above no repo root at all,
 * otherwise the single local repo.
 */
export function explainRepoRoots(cwd: string = process.cwd()): RootResolution {
  const local = findLocalRepo(cwd);
  return { roots: local ? [{ root: local, source: "local" }] : [] };
}

export function resolveRepoRoots(cwd: string = process.cwd()): ReadonlyArray<RepoRoot> {
  return explainRepoRoots(cwd).roots.map((r) => r.root);
}

/**
 * tsconfig.json for a framework sub-package (e.g. `bundled-features`,
 * `dev-server`) — ts-morph needs a real tsconfig as a moduleResolution
 * anchor when adding source files. Undefined when the local repo has no
 * usable tsconfig at all (e.g. a bare in-memory test workspace).
 */
export function frameworkPackageTsConfigPath(
  pkg: string,
  cwd: string = process.cwd(),
): string | undefined {
  const local = findLocalRepo(cwd);
  if (!local) return undefined;
  if (local.kind === "framework") {
    const packageTsConfig = resolve(local.absPath, `packages/${pkg}/tsconfig.json`);
    if (existsSync(packageTsConfig)) return packageTsConfig;
  }
  const localTsConfig = join(local.absPath, "tsconfig.json");
  return existsSync(localTsConfig) ? localTsConfig : undefined;
}

export function frameworkTsConfigPath(cwd?: string): string | undefined {
  return frameworkPackageTsConfigPath("framework", cwd);
}

export function isFlatSrcLayout(root: RepoRoot): boolean {
  return root.manifest.sourceRoots.length === 1 && root.manifest.sourceRoots[0] === "src";
}

// Only a whole-segment "*" is supported for dir expansion — "**" or a partial
// wildcard (e.g. "pkg*") has no single real directory to expand to.
function assertExpandablePattern(pattern: string): void {
  for (const segment of pattern.split("/")) {
    if (segment === "*") continue;
    if (/[*?[\]{}]/.test(segment)) {
      throw new Error(`sourceRootDirs: unsupported pattern for dir expansion: "${pattern}"`);
    }
  }
}

function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function expandSourceRootPattern(rootAbs: string, pattern: string): string[] {
  assertExpandablePattern(pattern);
  let current = [rootAbs];
  for (const segment of pattern.split("/")) {
    const next: string[] = [];
    for (const dir of current) {
      if (segment === "*") {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) next.push(join(dir, entry.name));
        }
      } else {
        const candidate = join(dir, segment);
        // lstat (not statSync) so a symlinked "src" dir is rejected, not followed.
        if (isRealDirectory(candidate)) next.push(candidate);
      }
    }
    current = next;
  }
  return current;
}

export function sourceRootDirs(root: RepoRoot): string[] {
  const out = new Set<string>();
  for (const pattern of root.manifest.sourceRoots) {
    for (const dir of expandSourceRootPattern(root.absPath, pattern)) {
      out.add(dir);
    }
  }
  return [...out].sort();
}
