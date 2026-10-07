import type { AgentManifest } from "./types.js";

// The deny list is deliberately not a manifest field (the manifest is prompt
// payload), so the catalog builder learns it through this side channel to
// detect a manifest cut that the catalog would silently not mirror.
const denyQnsByManifest = new WeakMap<AgentManifest, ReadonlySet<string>>();

export function recordManifestDenyQns(manifest: AgentManifest, denyQns: ReadonlySet<string>): void {
  denyQnsByManifest.set(manifest, denyQns);
}

export function assertCatalogMirrorsManifestDenyQns(
  manifest: AgentManifest,
  catalogDenyQns: ReadonlySet<string>,
): void {
  const manifestDenyQns = denyQnsByManifest.get(manifest);
  // skip: manifest has no registered deny list, nothing to mirror
  if (!manifestDenyQns) return;
  const missing = [...manifestDenyQns].filter((qn) => !catalogDenyQns.has(qn));
  if (missing.length > 0) {
    throw new Error(
      `agent denyQns passed to buildAgentManifest but not to buildToolCatalog: ${missing.join(", ")} — the catalog would still expose their entity CRUD tools`,
    );
  }
}
