import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { qualifyNavId } from "./nav-tree";

export type NavReparentOverride = { readonly parent: string; readonly order: number };

// Reduces every feature's `navs` to the app's sidebar allowlist, leaving
// screens/entities/handlers/translations and every other schema field
// untouched. Pure and defensive: a feature with no `navs` passes through
// unchanged, and a feature whose every nav gets stripped ends up with an
// empty `navs` array, never `undefined` turned into something broken.
//
// `reparentOverrides` (keyed by the nav's qualified QN) lets a foreign,
// otherwise-unmodifiable nav (e.g. a settings-hub-synthesized entry that
// can't be hand-re-registered under a new parent at boot-validation time)
// be "adopted" into a different section by rewriting its parent/order as
// it survives the allowlist filter. Without an override, a surviving nav's
// parent/order pass through unchanged.
export function filterAppSchemaNavsByAllowlist(
  schema: AppSchema,
  allowedNavQns: ReadonlySet<string>,
  reparentOverrides: ReadonlyMap<string, NavReparentOverride> = new Map(),
): AppSchema {
  return {
    ...schema,
    features: schema.features.map((feature): FeatureSchema => {
      if (feature.navs === undefined) return feature;
      return {
        ...feature,
        navs: feature.navs.flatMap((nav) => {
          const qn = qualifyNavId(feature.featureName, nav.id);
          if (!allowedNavQns.has(qn)) return [];
          const override = reparentOverrides.get(qn);
          return override === undefined
            ? [nav]
            : [{ ...nav, parent: override.parent, order: override.order }];
        }),
      };
    }),
  };
}
