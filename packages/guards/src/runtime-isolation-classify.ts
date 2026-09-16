// Pure classification helpers for the runtime-isolation guard.
//
// Extracted from `check-runtime-isolation.ts` so the regex/path logic
// can be unit-tested in isolation. The orchestration (ts-morph,
// process.exit, file walks) stays in the script.
//
// Why: the path-pattern table has historically had quiet bugs
// (e.g. `\/scripts\/` did not match `scripts/foo.ts` at repo-root,
// silently misclassifying tooling files as `runtime`). The unit-tests
// in `__tests__/runtime-isolation-classify.test.ts` lock the
// classification rules down so future edits trip a test, not a
// production drift.

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { ImportDeclaration, SourceFile } from "ts-morph";

export type Runtime = "runtime" | "client" | "dev" | "tooling" | "test";

export const ALL_RUNTIMES: ReadonlySet<string> = new Set([
  "runtime",
  "client",
  "dev",
  "tooling",
  "test",
]);

export const COMPAT: Record<Runtime, ReadonlySet<Runtime>> = {
  runtime: new Set(["runtime", "client"]),
  client: new Set(["client"]),
  dev: new Set(["runtime", "client", "dev", "tooling"]),
  tooling: new Set(["runtime", "client", "dev", "tooling", "test"]),
  test: new Set(["runtime", "client", "dev", "tooling", "test"]),
};

/**
 * Classify a file by its path relative to the repo root. Returns null
 * if no path-pattern matched (caller falls back to workspace / default).
 *
 * Pure function — accepts a repo-relative path string, no I/O.
 */
export function classifyByPath(repoRelativePath: string): Runtime | null {
  const rel = repoRelativePath.replace(/\\/g, "/");
  if (/\/(__tests__|testing)\//.test(rel)) return "test";
  if (/\/testing\.tsx?$/.test(rel)) return "test";
  if (/\.(test|integration|e2e)\.[tj]sx?$/.test(rel)) return "test";
  if (/(?:^|\/)scripts\//.test(rel)) return "tooling";
  if (/(?:^|\/)bin\//.test(rel)) return "tooling";
  if (/\/drizzle\/[^/]+\.ts$/.test(rel)) return "tooling";
  if (/\/drizzle\.config\.[tj]s$/.test(rel)) return "tooling";

  // Shared UI types are used by both client and runtime. In the kumiko isolation
  // model, "client" is the most permissive production category that "runtime"
  // can also import.
  if (/(?:^|\/)ui-types\//.test(rel)) return "client";

  // Same reasoning, two more shapes: a `web.ts`/`web/` subpath is the
  // established convention (locale-de, locale-es, bundled-features) for the
  // client-safe slice of an otherwise `"runtime"`-marked package — the
  // package.json marker classifies the whole package, this carves the
  // deliberately-named exception back out. Deliberately workspace-wide (any
  // repo, any depth), not framework-only: app repos' own `src/features/*/web/`
  // dirs follow the identical convention. `time`/`utils`/`engine/types`/`errors`
  // are framework's other isomorphic exports (published as their own subpath
  // exports, empirically zero Node-only or cross-module value imports, same
  // shape as `ui-types`). Scoped to `packages/framework/src/` specifically —
  // `utils`/`errors` are common enough directory names elsewhere that a
  // repo-wide match risks misclassifying an unrelated server-only folder in
  // some other package.
  if (/(?:^|\/)web\//.test(rel) || /\/web\.tsx?$/.test(rel)) return "client";
  if (/^packages\/framework\/src\/(?:time|utils|engine\/types|errors)\//.test(rel)) return "client";

  // More single-file carve-outs, same "package marker is coarser than the
  // file" shape, verified case by case rather than by a directory
  // convention:
  //  - locale-{de,es}/src/strings.ts: pure string-constant data (zero
  //    imports), re-exported by the already-client `web.ts` sibling in the
  //    same package but shadowed by the package's own `"runtime"` marker.
  if (/^packages\/locale-(?:de|es)\/src\/strings\.ts$/.test(rel)) return "client";
  //  - dev-server/src/env-schema.ts: a zod-only schema, no dev-server-
  //    internal imports — safe to carve out on its own.
  if (/^packages\/dev-server\/src\/env-schema\.ts$/.test(rel)) return "client";

  return null;
}

/**
 * App-repo browser bundle entry, mirroring kumiko-build's own discovery
 * (`discoverClientEntries` in kumiko-framework's
 * `packages/server-runtime/src/build-prod-bundle.ts`): `src/client.tsx`/
 * `src/client.ts` (single-entry) or `src/client-<suffix>.tsx?` (multi-entry).
 * Framework/enterprise packages never match — their sources live under
 * `packages/*\/src/`, not a repo-root `src/`. Kept independent of the
 * framework's own regex (cross-package import would be a build-vs-lint
 * layering violation) — if kumiko-build's discovery pattern changes, this
 * drifts and needs a matching update.
 */
export function isClientEntryPath(repoRelativePath: string): boolean {
  const rel = repoRelativePath.replace(/\\/g, "/");
  return /^src\/client(-[a-z][a-z0-9-]*)?\.tsx?$/.test(rel);
}

/**
 * An import declaration that survives `verbatimModuleSyntax` stripping and
 * therefore carries real runtime weight. Shared by the direct-edge check and
 * the client-reachability walk so both agree on what counts as an edge.
 */
export function isValueImport(decl: ImportDeclaration): boolean {
  if (decl.isTypeOnly()) return false;
  const named = decl.getNamedImports();
  if (
    named.length > 0 &&
    named.every((n) => n.isTypeOnly()) &&
    !decl.getDefaultImport() &&
    !decl.getNamespaceImport()
  ) {
    return false;
  }
  return true;
}

/**
 * Map dist declaration files back to src. Project References make ts-morph
 * resolve imports to `.d.ts` under `dist/`; classification and the reachable
 * set must use the same path.
 */
export function toEffectivePath(filePath: string): string {
  if (filePath.endsWith(".d.ts") && filePath.includes("/dist/")) {
    const base = filePath.replace("/dist/", "/src/").replace(/\.d\.ts$/, "");
    if (existsSync(`${base}.ts`)) return `${base}.ts`;
    if (existsSync(`${base}.tsx`)) return `${base}.tsx`;
  }
  return filePath;
}

/**
 * BFS over value-import edges starting at every file `isEntry` accepts.
 * Files reached this way are part of a browser bundle even when nothing in
 * their own path/directive/workspace marks them "client" — a plain helper
 * file, several hops from `src/client-*.tsx`, value-importing a server
 * subpath is exactly the drift this catches. Crossing into node_modules is
 * fine (ts-morph resolves workspace symlinks to the real package file);
 * only literal `node_modules/`/`dist/` targets are excluded, matching the
 * direct-edge check.
 */
export function computeClientReachablePaths(
  sourceFiles: readonly SourceFile[],
  isEntry: (sourceFile: SourceFile) => boolean,
): ReadonlySet<string> {
  const reached = new Set<string>();
  const queue: SourceFile[] = sourceFiles.filter(isEntry);
  while (queue.length > 0) {
    const sf = queue.shift();
    if (!sf) break;
    const fp = toEffectivePath(sf.getFilePath());
    if (fp.includes("/node_modules/") || fp.includes("/dist/")) continue;
    if (reached.has(fp)) continue;
    reached.add(fp);
    for (const decl of sf.getImportDeclarations()) {
      if (!isValueImport(decl)) continue;
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue;
      const targetPath = toEffectivePath(target.getFilePath());
      if (targetPath.includes("/node_modules/") || targetPath.includes("/dist/")) continue;
      if (!reached.has(targetPath)) queue.push(target);
    }
  }
  return reached;
}

/**
 * Classify a file by its top-of-file `// @runtime <kind>` directive.
 * Reads the first 600 bytes only (cap blast radius on huge files).
 */
export function classifyByDirective(filePath: string): Runtime | null {
  let head: string;
  try {
    head = readFileSync(filePath, "utf8").slice(0, 600);
  } catch {
    return null;
  }
  for (const line of head.split("\n").slice(0, 8)) {
    const m = line.match(/\/\/\s*@runtime\s+(\w+)/);
    if (m && ALL_RUNTIMES.has(m[1] ?? "")) return m[1] as Runtime;
  }
  return null;
}

/**
 * Walk upward from `filePath` looking for the nearest package.json that
 * carries a `kumiko.runtime` marker. Stops at `repoRoot`. Caches per
 * directory in the supplied map so a long scan only reads each
 * package.json once.
 */
export function findWorkspaceRuntime(
  filePath: string,
  repoRoot: string,
  cache: Map<string, Runtime | null>,
): Runtime | null {
  let dir = path.dirname(filePath);
  while (dir.startsWith(repoRoot) && dir !== repoRoot) {
    const r = readWorkspaceRuntime(dir, cache);
    if (r) return r;
    // Stop at the first package.json — don't fall through to a parent
    // workspace that happens to have a marker.
    try {
      readFileSync(path.join(dir, "package.json"), "utf8");
      return null;
    } catch {
      // No package.json here — keep climbing.
    }
    dir = path.dirname(dir);
  }
  return null;
}

function readWorkspaceRuntime(dir: string, cache: Map<string, Runtime | null>): Runtime | null {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  const pkgPath = path.join(dir, "package.json");
  let result: Runtime | null = null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const r = pkg.kumiko?.runtime;
    if (typeof r === "string" && ALL_RUNTIMES.has(r)) result = r as Runtime;
  } catch {
    // package.json missing or unreadable — unmarked
  }
  cache.set(dir, result);
  return result;
}

/**
 * Compose the classification layers (directive > path > workspace >
 * client-reachability > default) into one call. The cache is owned by the
 * caller so a single scan amortizes the workspace-lookup across files.
 *
 * `clientReachable` only ever promotes the *default* — a file with an
 * explicit directive, a matched path pattern, or a workspace marker keeps
 * that classification regardless of reachability. This is what lets a
 * framework file explicitly marked `"runtime"` (e.g. `engine/index.ts`) stay
 * "runtime" even when a client bundle reaches it — which is exactly the
 * violation this guard needs to see, not paper over.
 */
export function classify(
  filePath: string,
  repoRoot: string,
  workspaceCache: Map<string, Runtime | null>,
  clientReachable?: ReadonlySet<string>,
): Runtime {
  const effectivePath = toEffectivePath(filePath);

  const rel = path.relative(repoRoot, effectivePath);
  return (
    classifyByDirective(effectivePath) ??
    classifyByPath(rel) ??
    findWorkspaceRuntime(effectivePath, repoRoot, workspaceCache) ??
    (clientReachable?.has(effectivePath) ? "client" : undefined) ??
    "runtime"
  );
}

export type Violation = {
  readonly file: string;
  readonly line: number;
  readonly fileRuntime: Runtime;
  readonly importedSpec: string;
  readonly importedFile: string;
  readonly importedRuntime: Runtime;
};

/**
 * The direct-edge half of the guard: classify every scanned file, then flag
 * every value-import whose target runtime the source runtime isn't allowed
 * to depend on (`COMPAT`). `clientReachable` (from `computeClientReachablePaths`)
 * is threaded through so a file pulled into a browser bundle gets judged as
 * "client" even without its own directive/path/workspace marker.
 */
export function findRuntimeIsolationViolations(
  sourceFiles: readonly SourceFile[],
  repoRoot: string,
  workspaceCache: Map<string, Runtime | null>,
  clientReachable: ReadonlySet<string> = new Set(),
): {
  readonly violations: readonly Violation[];
  readonly stats: Record<Runtime, number>;
  /** Import targets (or scanned files) that resolved outside the repo root. */
  readonly outsideRoot: readonly string[];
} {
  const violations: Violation[] = [];
  const outsideRoot: string[] = [];
  const seenOutside = new Set<string>();
  const noteOutside = (fp: string) => {
    if (seenOutside.has(fp)) return;
    seenOutside.add(fp);
    outsideRoot.push(fp);
  };
  const stats: Record<Runtime, number> = { runtime: 0, client: 0, dev: 0, tooling: 0, test: 0 };
  const withinRoot = (fp: string) => fp === repoRoot || fp.startsWith(`${repoRoot}/`);

  for (const sf of sourceFiles) {
    const fp = sf.getFilePath();
    if (fp.includes("/node_modules/") || fp.includes("/dist/")) continue;
    if (!withinRoot(fp)) {
      noteOutside(fp);
      continue;
    }
    const fileRt = classify(fp, repoRoot, workspaceCache, clientReachable);
    stats[fileRt]++;

    for (const decl of sf.getImportDeclarations()) {
      if (!isValueImport(decl)) continue;
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue;
      const targetPath = target.getFilePath();
      if (targetPath.includes("/node_modules/")) continue;
      if (!withinRoot(targetPath)) {
        noteOutside(targetPath);
        continue;
      }
      const targetRt = classify(targetPath, repoRoot, workspaceCache, clientReachable);

      if (!COMPAT[fileRt].has(targetRt)) {
        violations.push({
          file: fp,
          line: decl.getStartLineNumber(),
          fileRuntime: fileRt,
          importedSpec: decl.getModuleSpecifierValue(),
          importedFile: targetPath,
          importedRuntime: targetRt,
        });
      }
    }
  }

  return { violations, stats, outsideRoot };
}
