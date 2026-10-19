import {
  composeTierResolverWithGlobalToggles,
  createFeatureToggleRuntime,
  createFeatureTogglesFeature,
  type GlobalFeatureToggleRuntime,
} from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  EffectiveFeaturesResolver,
  FeatureDefinition,
  Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import type { CacheSyncBus } from "@cosmicdrift/kumiko-framework/redis";

export type FeatureTogglesBinding = {
  /** Resolver for the dispatcher: the global toggles, narrowing the tier resolver when one exists. */
  readonly resolver: EffectiveFeaturesResolver;
};

export type FeatureTogglesWiring = {
  readonly feature: FeatureDefinition;
  /** Loads the toggle snapshot; call once the database, the registry and the cache bus exist. */
  readonly bind: (deps: {
    readonly db: DbConnection;
    readonly registry: Registry;
    readonly cacheSync: CacheSyncBus;
    readonly tierResolver: EffectiveFeaturesResolver | undefined;
  }) => Promise<FeatureTogglesBinding>;
};

/** `featureToggles: true` mounts `feature-toggles` and layers its operator switches over the tier resolver. */
export function resolveFeatureTogglesOption(): FeatureTogglesWiring {
  let runtime: GlobalFeatureToggleRuntime | undefined;
  const feature = createFeatureTogglesFeature({
    getRuntime: () => {
      if (runtime === undefined) {
        throw new Error("feature-toggles: the toggle runtime is not bound yet (boot order).");
      }
      return runtime;
    },
  });
  return {
    feature,
    bind: async ({ db, registry, cacheSync, tierResolver }) => {
      runtime = await createFeatureToggleRuntime(db, registry, undefined, cacheSync);
      const toggles = runtime;
      return {
        resolver: tierResolver
          ? composeTierResolverWithGlobalToggles(tierResolver, toggles, registry)
          : () => toggles.effectiveFeatures(),
      };
    },
  };
}
