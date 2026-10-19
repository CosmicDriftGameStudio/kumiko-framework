import type { AppSchema, FeatureSchema } from "../../index.ts";
import { qualifyNavId } from "./nav-tree.tsx";

export type NavReparentOverride = { readonly parent: string; readonly order: number };

// Rewrites parent/order of the navs named in `overrides` (keyed by the nav's
// qualified QN), leaving every other nav and schema field untouched. This is
// how an app moves a foreign, otherwise-unmodifiable nav (a bundled feature's
// own entry, a settings-hub-synthesized one) into a group of its own: the
// boot-validator only lets a feature re-parent navs it registered itself.
export function reparentAppSchemaNavs(
  schema: AppSchema,
  overrides: ReadonlyMap<string, NavReparentOverride>,
): AppSchema {
  if (overrides.size === 0) return schema;
  return {
    ...schema,
    features: schema.features.map((feature): FeatureSchema => {
      if (feature.navs === undefined) return feature;
      return {
        ...feature,
        navs: feature.navs.map((nav) => {
          const override = overrides.get(qualifyNavId(feature.featureName, nav.id));
          return override === undefined
            ? nav
            : { ...nav, parent: override.parent, order: override.order };
        }),
      };
    }),
  };
}

// Reduces every feature's `navs` to the app's sidebar allowlist, leaving
// screens/entities/handlers/translations and every other schema field
// untouched. Pure and defensive: a feature with no `navs` passes through
// unchanged, and a feature whose every nav gets stripped ends up with an
// empty `navs` array, never `undefined` turned into something broken.
//
// An allowed nav whose parent exists but is not on the allowlist (and which has
// no reparent override) loses its `parent` and surfaces at the top level, the same
// as with `allowedNavQns` in buildNavRegistrySliceForApp; without that,
// dropNavsWithNonexistentParent would drop it silently.
//
// `reparentOverrides` re-parents the surviving navs (see reparentAppSchemaNavs).
export function filterAppSchemaNavsByAllowlist(
  schema: AppSchema,
  allowedNavQns: ReadonlySet<string>,
  reparentOverrides: ReadonlyMap<string, NavReparentOverride> = new Map(),
): AppSchema {
  const existingNavQns = new Set(
    schema.features.flatMap((feature) =>
      (feature.navs ?? []).map((nav) => qualifyNavId(feature.featureName, nav.id)),
    ),
  );
  const parentFilteredOut = (featureName: string, nav: NavOf): boolean => {
    if (nav.parent === undefined) return false;
    const parentQn = qualifyNavId(featureName, nav.parent);
    return existingNavQns.has(parentQn) && !allowedNavQns.has(parentQn);
  };
  const allowed: AppSchema = {
    ...schema,
    features: schema.features.map((feature): FeatureSchema => {
      if (feature.navs === undefined) return feature;
      return {
        ...feature,
        navs: feature.navs
          .filter((nav) => allowedNavQns.has(qualifyNavId(feature.featureName, nav.id)))
          .map((nav) =>
            parentFilteredOut(feature.featureName, nav) &&
            !reparentOverrides.has(qualifyNavId(feature.featureName, nav.id))
              ? withoutParent(nav)
              : nav,
          ),
      };
    }),
  };
  return reparentAppSchemaNavs(allowed, reparentOverrides);
}

type NavOf = NonNullable<FeatureSchema["navs"]>[number];

function withoutParent(nav: NavOf): NavOf {
  const { parent: _filteredOutParent, ...topLevelNav } = nav;
  return topLevelNav;
}
