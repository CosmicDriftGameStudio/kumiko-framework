// Tenant-level counterpart to projectAppSchemaForRoles: removes the UI surface
// (screens, navs, content collections, workspaces) of features the tenant has
// switched off via r.toggleable(). Entities and translations stay — enabled
// features may still reference them. Screens that declare a `fallback` (plus
// the same-feature screens those fallbacks name) are the exception: their
// visibleWhen probe is rejected by the feature gate for this tenant, which is
// what makes the renderer show the fallback (e.g. an upgrade notice). Dropping
// them would also drop every nav of another feature pointing at them, so the
// fallback could never be reached. Run BEFORE the role projection: it keeps
// only targets that exist in the schema, so once the disabled screens/navs are
// gone it also drops every action, redirect, nav and workspace member that
// pointed at them. The one reference it does not resolve is a nav `parent`
// pointing at a missing nav; that is pruned here.

import type { AppSchema, FeatureSchema } from "../ui-types/app-schema.ts";
import { resolveScreenTargetQn } from "./boot-validator/screens.ts";
import { isToggleableFeature } from "./effective-features.ts";
import { isValidQn, qualifyEntityName } from "./qualified-name.ts";
import type { EffectiveFeaturesResolver } from "./tier-resolver-extension.ts";
import type { Registry } from "./types/feature.ts";
import type { TenantId } from "./types/identifiers.ts";

// Sorted, so the result doubles as a stable cache key. The trial gate is
// consulted like the dispatcher's feature gate does, but only for toggleable
// features: a trial can only unlock tier (toggleable) features, so a
// cascade-disabled always-on feature needs no gate call.
export async function resolveDisabledFeatureNames(
  registry: Registry,
  effectiveFeatures: EffectiveFeaturesResolver,
  tenantId: TenantId,
): Promise<readonly string[]> {
  const enabled = effectiveFeatures(tenantId);
  const disabled: string[] = [];
  for (const [featureName, feature] of registry.features) {
    if (enabled.has(featureName)) continue;
    if (
      isToggleableFeature(feature) &&
      (await effectiveFeatures.trialGate?.(tenantId, featureName))
    ) {
      continue;
    }
    disabled.push(featureName);
  }
  return disabled.sort();
}

function navParentQn(featureName: string, parent: string): string {
  return isValidQn(parent) ? parent : qualifyEntityName(featureName, "nav", parent);
}

// Navs of enabled features whose parent chain ends in a removed nav.
function collectOrphanedNavQns(
  features: readonly FeatureSchema[],
  removedNavQns: Set<string>,
): ReadonlySet<string> {
  const orphaned = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of features) {
      for (const nav of feature.navs ?? []) {
        const qn = qualifyEntityName(feature.featureName, "nav", nav.id);
        if (removedNavQns.has(qn) || nav.parent === undefined) continue;
        if (removedNavQns.has(navParentQn(feature.featureName, nav.parent))) {
          removedNavQns.add(qn);
          orphaned.add(qn);
          changed = true;
        }
      }
    }
  }
  return orphaned;
}

// Fail-closed for the kept screens: the server gate rejects their handlers and
// queries for the tenant, only the schema entry stays so the fallback can render.
function screensKeptForFallback(feature: FeatureSchema): FeatureSchema["screens"] {
  const qnOf = (screenId: string) => qualifyEntityName(feature.featureName, "screen", screenId);
  const byQn = new Map(feature.screens.map((screen) => [qnOf(screen.id), screen]));
  const kept = new Set<string>();
  const pending = feature.screens.filter((screen) => screen.fallback !== undefined);
  for (const screen of pending) kept.add(qnOf(screen.id));
  while (pending.length > 0) {
    const fallback = pending.pop()?.fallback;
    if (fallback === undefined) continue;
    const targetQn = resolveScreenTargetQn(feature.featureName, fallback);
    const target = byQn.get(targetQn);
    if (target === undefined || kept.has(targetQn)) continue;
    kept.add(targetQn);
    pending.push(target);
  }
  return feature.screens.filter((screen) => kept.has(qnOf(screen.id)));
}

export function stripDisabledFeaturesFromAppSchema(
  schema: AppSchema,
  registry: Registry,
  disabledFeatureNames: readonly string[],
): AppSchema {
  if (disabledFeatureNames.length === 0) return schema;
  const disabled = new Set(disabledFeatureNames);

  const removedNavQns = new Set<string>();
  for (const feature of schema.features) {
    if (!disabled.has(feature.featureName)) continue;
    for (const nav of feature.navs ?? []) {
      removedNavQns.add(qualifyEntityName(feature.featureName, "nav", nav.id));
    }
  }
  const orphanedNavQns = collectOrphanedNavQns(schema.features, removedNavQns);

  const features = schema.features.map((feature) => {
    if (disabled.has(feature.featureName)) {
      const { navs: _navs, contentCollections: _collections, workspaces: _ws, ...rest } = feature;
      return { ...rest, screens: screensKeptForFallback(feature) };
    }
    if (orphanedNavQns.size === 0 || feature.navs === undefined) return feature;
    const navs = feature.navs.filter(
      (nav) => !orphanedNavQns.has(qualifyEntityName(feature.featureName, "nav", nav.id)),
    );
    if (navs.length === feature.navs.length) return feature;
    const { navs: _navs, ...rest } = feature;
    return navs.length > 0 ? { ...rest, navs } : rest;
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
