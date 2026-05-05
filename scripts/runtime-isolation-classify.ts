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

import { readFileSync } from "node:fs";
import * as path from "node:path";

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
  tooling: new Set(["runtime", "client", "dev", "tooling"]),
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
  return null;
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

function readWorkspaceRuntime(
  dir: string,
  cache: Map<string, Runtime | null>,
): Runtime | null {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  const pkgPath = path.join(dir, "package.json");
  let result: Runtime | null = null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const r = pkg.kumiko?.runtime;
    if (typeof r === "string" && ALL_RUNTIMES.has(r)) result = r as Runtime;
  } catch {
    // package.json fehlt oder unlesbar — unmarkiert
  }
  cache.set(dir, result);
  return result;
}

/**
 * Compose the four classification layers (directive > path > workspace >
 * default) into one call. The cache is owned by the caller so a single
 * scan amortizes the workspace-lookup across files.
 */
export function classify(
  filePath: string,
  repoRoot: string,
  workspaceCache: Map<string, Runtime | null>,
): Runtime {
  const rel = path.relative(repoRoot, filePath);
  return (
    classifyByDirective(filePath) ??
    classifyByPath(rel) ??
    findWorkspaceRuntime(filePath, repoRoot, workspaceCache) ??
    "runtime"
  );
}
