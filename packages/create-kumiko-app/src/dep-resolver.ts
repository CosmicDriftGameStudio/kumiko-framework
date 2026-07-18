// Closes a feature set under `requires` (transitive hard dependencies).
// The picker only asks about explicit selections; this resolver folds in
// every dep so the scaffolded run-config.ts is bootable as-is.
//
// Output is the deterministic set of feature names, in the order the
// caller can hand to scaffoldApp. Cycles (none in practice) self-terminate
// via the visited-set; unknown deps (a manifest feature requires X but X
// isn't in the manifest) throw — that's a manifest bug worth surfacing.

import type { Manifest, ManifestFeatureEntry } from "./manifest";

export type DepResolutionResult = {
  /** Selected + transitively required features, in stable scaffold order. */
  readonly featureNames: readonly string[];
  /** Features added implicitly via requires (not in the original selection). */
  readonly autoAdded: readonly string[];
};

export function resolveDeps(selected: readonly string[], manifest: Manifest): DepResolutionResult {
  const byName = new Map<string, ManifestFeatureEntry>(manifest.features.map((f) => [f.name, f]));
  const visited = new Set<string>();
  const autoAdded = new Set<string>();
  const selectedSet = new Set(selected);

  function visit(name: string): void {
    // skip: feature already visited, avoid infinite recursion on cyclic requires
    if (visited.has(name)) return;
    visited.add(name);
    const entry = byName.get(name);
    if (!entry) {
      throw new Error(
        `resolveDeps: feature "${name}" not in manifest (referenced as require/selection)`,
      );
    }
    if (!selectedSet.has(name)) autoAdded.add(name);
    for (const dep of entry.requires) visit(dep);
  }

  for (const name of selected) visit(name);

  return {
    featureNames: [...visited],
    autoAdded: [...autoAdded],
  };
}
