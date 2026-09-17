import { realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { RepoKind } from "@cosmicdrift/kumiko-repo-manifest";
import { Glob } from "bun";
import type { RepoRoot } from "./roots";

export type ScanScope = "source" | "tests";
export type ScanExtension = "ts" | "tsx";

type ScanSpecBase = {
  readonly extensions: readonly ScanExtension[];
  /** Manifest roles to scan; omitted = every root except "tooling" — a guard
   *  must opt in to scanning an infra/build-tooling root explicitly. */
  readonly kinds?: readonly RepoKind[];
  /** Repo-relative globs; in a kind "framework" root only files matching one of them are kept (replaces `within` there). */
  readonly frameworkWithin?: readonly string[];
};

export type ScanSpec =
  | (ScanSpecBase & {
      readonly scope: "source";
      /** Globs relative to the matched source root dir; narrows only. */
      readonly within?: readonly string[];
    })
  | (ScanSpecBase & { readonly scope: "tests" });

export type RootScan = {
  readonly root: RepoRoot;
  /** Absolute paths handed to the guard, sorted. */
  readonly files: readonly string[];
  /** All .ts/.tsx under the declared sourceRoots minus excludes, before extension/within filters — the D4 floor input. */
  readonly sourceSurface: number;
};

type Hit = {
  readonly repoRel: string;
  /** Set only for source hits — the path relative to the matched sourceRoot. */
  readonly sourceRootRel?: string;
};

// Many guards share the same source/test surface per root — scan each
// (root, pattern) pair from disk only once per process.
const globScanCache = new Map<string, readonly string[]>();

function scanGlob(rootAbsPath: string, pattern: string): readonly string[] {
  const key = JSON.stringify([rootAbsPath, pattern]);
  const cached = globScanCache.get(key);
  if (cached) return cached;
  const rootReal = realpathSync(rootAbsPath);
  const hits: string[] = [];
  for (const rel of new Glob(pattern).scanSync({
    cwd: rootAbsPath,
    onlyFiles: true,
    followSymlinks: false,
    dot: false,
  })) {
    let real: string;
    try {
      real = realpathSync(join(rootAbsPath, rel));
    } catch {
      continue;
    }
    // A symlinked file pointing outside the repo is never scanned — the same
    // escape a symlinked directory would give if followSymlinks allowed it.
    if (real !== rootReal && !real.startsWith(rootReal + sep)) continue;
    hits.push(rel);
  }
  globScanCache.set(key, hits);
  return hits;
}

function matchesAny(repoRel: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Glob(pattern).match(repoRel));
}

function sourceRootRelOf(repoRel: string, sourceRoot: string): string | undefined {
  const segments = repoRel.split("/");
  for (let k = 1; k <= segments.length; k++) {
    if (new Glob(sourceRoot).match(segments.slice(0, k).join("/"))) {
      return segments.slice(k).join("/");
    }
  }
  return undefined;
}

function sourceHits(root: RepoRoot): Hit[] {
  const byRepoRel = new Map<string, Hit>();
  for (const sourceRoot of root.manifest.sourceRoots) {
    for (const repoRel of scanGlob(root.absPath, `${sourceRoot}/**/*.{ts,tsx}`)) {
      // First matching sourceRoot wins for overlapping sourceRoots.
      if (byRepoRel.has(repoRel)) continue;
      byRepoRel.set(repoRel, {
        repoRel,
        sourceRootRel: sourceRootRelOf(repoRel, sourceRoot),
      });
    }
  }
  return [...byRepoRel.values()];
}

function testHits(root: RepoRoot): Hit[] {
  const byRepoRel = new Map<string, Hit>();
  for (const testGlob of root.manifest.testGlobs) {
    for (const repoRel of scanGlob(root.absPath, testGlob)) {
      if (byRepoRel.has(repoRel)) continue;
      byRepoRel.set(repoRel, { repoRel });
    }
  }
  return [...byRepoRel.values()];
}

function afterExcludes(hits: readonly Hit[], excludes: readonly string[] | undefined): Hit[] {
  if (!excludes || excludes.length === 0) return [...hits];
  return hits.filter((hit) => !matchesAny(hit.repoRel, excludes));
}

function hasScanExtension(repoRel: string, extensions: readonly ScanExtension[]): boolean {
  return extensions.some((ext) => repoRel.endsWith(`.${ext}`));
}

function keepForSpec(hit: Hit, root: RepoRoot, spec: ScanSpec): boolean {
  if (!hasScanExtension(hit.repoRel, spec.extensions)) return false;
  if (root.kind === "framework" && spec.frameworkWithin) {
    return matchesAny(hit.repoRel, spec.frameworkWithin);
  }
  if (spec.scope === "source" && spec.within) {
    return hit.sourceRootRel !== undefined && matchesAny(hit.sourceRootRel, spec.within);
  }
  return true;
}

function scanRoot(spec: ScanSpec, root: RepoRoot): RootScan {
  const sourceSurfaceHits = afterExcludes(sourceHits(root), root.manifest.excludes);
  const scopeHits =
    spec.scope === "source"
      ? sourceSurfaceHits
      : afterExcludes(testHits(root), root.manifest.excludes);
  const files = scopeHits
    .filter((hit) => keepForSpec(hit, root, spec))
    .map((hit) => join(root.absPath, hit.repoRel))
    .sort();
  return { root, files, sourceSurface: sourceSurfaceHits.length };
}

function keepsRootKind(spec: ScanSpec, root: RepoRoot): boolean {
  if (spec.kinds) return spec.kinds.includes(root.kind);
  return root.kind !== "tooling";
}

export function scanRoots(spec: ScanSpec, roots: readonly RepoRoot[]): RootScan[] {
  return roots.filter((root) => keepsRootKind(spec, root)).map((root) => scanRoot(spec, root));
}

export function scanFiles(spec: ScanSpec, roots: readonly RepoRoot[]): string[] {
  return [...new Set(scanRoots(spec, roots).flatMap((rootScan) => rootScan.files))].sort();
}
