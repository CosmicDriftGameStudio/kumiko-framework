// Tenant-level counterpart to projectAppSchemaForRoles: removes the UI surface
// (screens, navs, content collections, workspaces) of features the tenant has
// switched off via r.toggleable(). Entities and translations stay — enabled
// features may still reference them. Run BEFORE the role projection: with the
// disabled screens/navs gone from the schema, the role projection also drops
// every action, redirect and workspace member that pointed at them.

import type { AppSchema } from "../ui-types/app-schema.js";
import type { EffectiveFeaturesResolver } from "./tier-resolver-extension.js";
import type { Registry } from "./types/feature.js";
import type { TenantId } from "./types/identifiers.js";

// Sorted, so the result doubles as a stable cache key. The trial gate is
// consulted like the dispatcher's feature gate does: a feature the synchronous
// resolver reports off but the live trial unlocks is still reachable.
export async function resolveDisabledFeatureNames(
  registry: Registry,
  effectiveFeatures: EffectiveFeaturesResolver,
  tenantId: TenantId,
): Promise<readonly string[]> {
  const enabled = effectiveFeatures(tenantId);
  const disabled: string[] = [];
  for (const featureName of registry.features.keys()) {
    if (enabled.has(featureName)) continue;
    if (await effectiveFeatures.trialGate?.(tenantId, featureName)) continue;
    disabled.push(featureName);
  }
  return disabled.sort();
}

export function stripDisabledFeaturesFromAppSchema(
  schema: AppSchema,
  registry: Registry,
  disabledFeatureNames: readonly string[],
): AppSchema {
  if (disabledFeatureNames.length === 0) return schema;
  const disabled = new Set(disabledFeatureNames);

  const features = schema.features.map((feature) => {
    if (!disabled.has(feature.featureName)) return feature;
    const { navs: _navs, contentCollections: _collections, workspaces: _ws, ...rest } = feature;
    return { ...rest, screens: [] };
  });

  // Workspace definitions carry the short id the author declared; the owning
  // feature is only known to the registry.
  const disabledWorkspaceIds = new Set(
    disabledFeatureNames.flatMap((featureName) =>
      Object.keys(registry.features.get(featureName)?.workspaces ?? {}),
    ),
  );
  const workspaces = schema.workspaces?.filter((ws) => !disabledWorkspaceIds.has(ws.definition.id));

  const { workspaces: _original, ...restSchema } = schema;
  return {
    ...restSchema,
    features,
    ...(workspaces !== undefined && workspaces.length > 0 && { workspaces }),
  };
}
