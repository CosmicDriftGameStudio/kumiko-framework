// Shared by baseline-ratchet guards (check-complexity, guard-pii-
// annotations) and the security-baseline module: per-file current-vs-baseline
// count diff. More than baseline is a regression; less is allowed but doesn't
// auto-update the baseline.
export interface BaselineRegression {
  readonly file: string;
  readonly baseline: number;
  readonly current: number;
}

export function compareToBaseline(
  current: Readonly<Record<string, number>>,
  baseline: Readonly<Record<string, number>>,
): {
  regressions: BaselineRegression[];
  reduced: number;
  reductions: BaselineRegression[];
} {
  const regressions: BaselineRegression[] = [];
  const reductions: BaselineRegression[] = [];
  let reduced = 0;
  for (const file of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const expected = baseline[file] ?? 0;
    const actual = current[file] ?? 0;
    if (actual > expected) {
      regressions.push({ file, baseline: expected, current: actual });
    } else if (actual < expected) {
      reduced += expected - actual;
      reductions.push({ file, baseline: expected, current: actual });
    }
  }
  regressions.sort((a, b) => a.file.localeCompare(b.file));
  reductions.sort((a, b) => a.file.localeCompare(b.file));
  return { regressions, reduced, reductions };
}

// Shared by the import/symbol-restriction guards (guard-no-direct-fs,
// guard-restricted-symbols): relativize an absolute file path against the
// real repo root so ALLOWLIST/EXCLUDE regexes match a stable, anchored path
// instead of an arbitrary substring. resolveRepoRoots() finds the repo the
// path actually lives under; the marker-slice below is a fallback ONLY for
// ts-morph's in-memory test filesystem, whose paths never match a real repo
// root (e.g. "/packages/framework/src/x.ts" in a unit test). Unresolvable
// paths throw — returning the absolute path re-opens ancestor-segment
// EXCLUDE false-negatives (tools/bin matching above the repo root).
export function findRepoRootFor<T extends { readonly absPath: string }>(
  filePath: string,
  roots: ReadonlyArray<T>,
): T | undefined {
  for (const root of roots) {
    if (filePath === root.absPath || filePath.startsWith(`${root.absPath}/`)) {
      return root;
    }
  }
  return undefined;
}
