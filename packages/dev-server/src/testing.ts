// Ready-made test functions that kumiko-testing cannot hold itself: it has no bundled-features or
// dev-server dependency, so those pieces are injected here and apps import the bound result.

import { hashPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  createMailTransportInMemoryFeature,
  getInbox,
} from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { TenantHandlers, TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { UserHandlers } from "@cosmicdrift/kumiko-bundled-features/user";
import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import { type FeatureDefinition, findTierResolverUsage } from "@cosmicdrift/kumiko-framework/engine";
import { resolveFeatureTogglesOption } from "@cosmicdrift/kumiko-server-runtime";
import { buildEffectiveFeaturesResolver } from "@cosmicdrift/kumiko-server-runtime/boot/shared-boot-steps";
import {
  type InProcessSeededTenant,
  type PersistedTenant,
  persistTenantRowsWith,
  type SeedBundledApi,
  type SeedRouteBundledApi,
  type SeedTenantOptions,
  type SeedWriter,
  seedTenantWith,
} from "@cosmicdrift/kumiko-testing";
import {
  createE2eSeedRoutes as createE2eSeedRoutesWith,
  type E2eSeedRoutesOptions,
} from "@cosmicdrift/kumiko-testing/e2e/seed-route";
import { pushEntityProjectionTables, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createDevLateBindings, createLateBoundEffectiveFeatures } from "./run-dev-app-auth.ts";
import {
  type SetupTestStackFromFeaturesOptions,
  setupTestStackFromFeatures,
} from "./setup-test-stack-from-features.ts";

export type SetupAppTestStackOptions = SetupTestStackFromFeaturesOptions & {
  readonly registryTables?: boolean;
  /** Same as `RunDevAppOptions["featureToggles"]`: mounts `feature-toggles` (do not list it in `features`)
   *  and layers its operator switches over the dispatcher's feature gate. Replaces `effectiveFeatures`. */
  readonly featureToggles?: boolean;
};

// A feature with a tenantTierResolver (tier-engine with a tierMap) gates handlers per tenant like
// runDevApp does; an explicit effectiveFeatures replaces it.
export async function setupAppTestStack(
  features: readonly FeatureDefinition[],
  options: SetupAppTestStackOptions = {},
): Promise<TestStack> {
  const {
    registryTables = true,
    includeBundled = true,
    featureToggles = false,
    ...stackOptions
  } = options;
  if (featureToggles && stackOptions.effectiveFeatures !== undefined) {
    throw new Error(
      "setupAppTestStack: featureToggles replaces effectiveFeatures, set only one of them.",
    );
  }
  const toggles = featureToggles ? resolveFeatureTogglesOption() : undefined;
  const stackFeatures = toggles === undefined ? features : [...features, toggles.feature];
  // Same late-bound resolver runDevApp builds, so a tier-engine tierMap and the operator toggles
  // gate handlers in app tests as in dev and prod. An explicit effectiveFeatures wins.
  const lateBindings = createDevLateBindings();
  const lateBoundResolver =
    stackOptions.effectiveFeatures === undefined
      ? createLateBoundEffectiveFeatures(
          lateBindings,
          toggles !== undefined || findTierResolverUsage(stackFeatures) !== undefined,
        )
      : undefined;
  const stack = await setupTestStackFromFeatures(stackFeatures, {
    ...stackOptions,
    includeBundled,
    entityTables: registryTables,
    ...(lateBoundResolver !== undefined && { effectiveFeatures: lateBoundResolver }),
  });
  try {
    // setupTestStack already created every entity table on a fresh DB (entityTables);
    // only a persistent DB can predate a column or index the sync backfills.
    if (registryTables && stackOptions.persistentDb === true) {
      await pushEntityProjectionTables(stack, stack.registry);
    }
    if (lateBoundResolver !== undefined) {
      lateBindings.tierResolver = await buildEffectiveFeaturesResolver({
        features: stackFeatures,
        featureToggles: toggles,
        db: stack.db,
        registry: stack.registry,
        cacheSync: stack.cacheSync,
      });
    }
  } catch (error) {
    await stack.cleanup();
    throw error;
  }
  return stack;
}

const seedBundledApi: SeedBundledApi = { hashPassword, UserHandlers, TenantHandlers };

const seedRouteBundledApi: SeedRouteBundledApi = {
  ...seedBundledApi,
  tenantMeQuery: TenantQueries.me,
  mailInbox: {
    featureName: createMailTransportInMemoryFeature().name,
    read: getInbox,
  },
};

export function seedTenant(
  stack: TestStack,
  options: SeedTenantOptions = {},
): Promise<InProcessSeededTenant> {
  return seedTenantWith(stack, options, seedBundledApi);
}

export function persistTenantRows(
  write: SeedWriter,
  options: {
    readonly name?: string;
    readonly users?: number;
    readonly admin?: SeedTenantOptions["admin"];
  } = {},
): Promise<PersistedTenant> {
  return persistTenantRowsWith(write, options, seedBundledApi);
}

export function createE2eSeedRoutes(
  options: E2eSeedRoutesOptions = {},
): readonly ExtraRouteDefinition[] {
  return createE2eSeedRoutesWith(options, seedRouteBundledApi);
}
