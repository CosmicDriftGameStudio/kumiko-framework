#!/usr/bin/env bun
/**
 * Single-Runtime-Instance Guard (kumiko-studio#229).
 *
 * A Kumiko runtime library resolved at two versions in one bun.lock (a nested
 * copy under a feature package next to the top-level install) loads twice in
 * one process: two registries, two module singletons. This flags every
 * Kumiko-scoped package with more than one distinct resolved version unless
 * its `kumiko.runtime` marker says dev/tooling/test (those never share a
 * process with the app runtime). A package with no marker, or one not
 * installed, is treated as runtime — fail closed.
 *
 * Copies nested under a dev/tooling/test-marked ancestor (e.g. kumiko-guards >
 * kumiko-cli > kumiko-framework) belong to the dev-tool subtree, not the app
 * process: they are ignored, and drift is judged on the remaining entries. An
 * ancestor without marker does not protect its subtree.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type LockPackage, readLockfilePackages } from "./_lib/bun-lock-packages";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { ALL_RUNTIMES } from "./runtime-isolation-classify";

const KUMIKO_PACKAGE_SCOPES: readonly string[] = ["@cosmicdrift/", "@cosmicdriftgamestudio/"];
const WORKSPACE_VERSION_PREFIX = "workspace:";
const EXEMPT_MARKERS: ReadonlySet<string> = new Set(["dev", "tooling", "test"]);

function isKumikoPackage(name: string): boolean {
  return KUMIKO_PACKAGE_SCOPES.some((scope) => name.startsWith(scope));
}

// Node-style lookup: the parent workspace hoists installs above the repo root.
function readRuntimeMarker(rootAbsPath: string, packageName: string): string | undefined {
  let dir = rootAbsPath;
  for (;;) {
    const pkgPath = join(dir, "node_modules", packageName, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const marker = (
          JSON.parse(readFileSync(pkgPath, "utf8")) as { kumiko?: { runtime?: unknown } }
        ).kumiko?.runtime; // @cast-boundary package-json
        return typeof marker === "string" && ALL_RUNTIMES.has(marker) ? marker : undefined;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// A copy lives in the dev-tool subtree when any ancestor segment of its lockKey is dev/tooling/test-marked.
function lockKeyAncestors(lockKey: string): string[] {
  const names: string[] = [];
  const segments = lockKey.split("/");
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] ?? "";
    if (segment.startsWith("@") && i + 1 < segments.length) {
      names.push(`${segment}/${segments[i + 1]}`);
      i++;
    } else {
      names.push(segment);
    }
  }
  return names.slice(0, -1);
}

function groupByName(packages: readonly LockPackage[]): Map<string, LockPackage[]> {
  const byName = new Map<string, LockPackage[]>();
  for (const pkg of packages) {
    if (pkg.version.startsWith(WORKSPACE_VERSION_PREFIX) || !isKumikoPackage(pkg.name)) continue;
    const group = byName.get(pkg.name) ?? [];
    group.push(pkg);
    byName.set(pkg.name, group);
  }
  return byName;
}

export const check: RepoCheck = {
  name: "Single-Runtime-Instance Guard",
  hint:
    "A runtime/client/prod Kumiko package resolves at more than one version in bun.lock, so two " +
    "instances load in one process. Align the dependency ranges so one version satisfies all " +
    'dependents, or pin it via root `overrides`. Packages marked kumiko.runtime "dev", "tooling" ' +
    'or "test", and copies nested under such a package, are exempt.',
  run(roots: readonly RepoRoot[]) {
    const violations: { file: string; line: number; message: string }[] = [];
    let matchedFiles = 0;
    for (const root of roots) {
      const markerCache = new Map<string, string | undefined>();
      const markerOf = (name: string): string | undefined => {
        if (!markerCache.has(name)) markerCache.set(name, readRuntimeMarker(root.absPath, name));
        return markerCache.get(name);
      };
      const isUnderExemptAncestor = (lockKey: string): boolean =>
        lockKeyAncestors(lockKey).some((ancestor) => EXEMPT_MARKERS.has(markerOf(ancestor) ?? ""));
      const lock = readLockfilePackages(root.absPath);
      if (lock === undefined) continue;
      matchedFiles++;
      if (!lock.ok) {
        violations.push({
          file: "bun.lock",
          line: 1,
          message: `bun.lock could not be parsed (${root.name}): ${lock.reason}`,
        });
        continue;
      }
      for (const [name, allEntries] of groupByName(lock.packages)) {
        const marker = markerOf(name);
        if (marker !== undefined && EXEMPT_MARKERS.has(marker)) continue;
        const entries = allEntries.filter((e) => !isUnderExemptAncestor(e.lockKey));
        if (new Set(entries.map((e) => e.version)).size < 2) continue;
        const nested = entries.filter((e) => e.lockKey !== name);
        const firstNestedLine = Math.min(
          ...(nested.length > 0 ? nested : entries).map((e) => e.line),
        );
        const versions = entries.map((e) => `${e.version} (${e.lockKey})`).join(", ");
        violations.push({
          file: "bun.lock",
          line: firstNestedLine,
          message: `${name} [${marker ?? "no kumiko.runtime marker"}] resolves at ${new Set(entries.map((e) => e.version)).size} versions in ${root.name}: ${versions}`,
        });
      }
    }
    return { violations, matchedFiles, notApplicable: matchedFiles === 0 };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check], resolveRepoRoots()));
  process.exit(failed > 0 ? 1 : 0);
}
