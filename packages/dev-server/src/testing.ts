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
import type {
  EffectiveFeaturesResolver,
  FeatureDefinition,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveFeatureTogglesOption } from "@cosmicdrift/kumiko-server-runtime";
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
  const toggleResolver: { current: EffectiveFeaturesResolver | undefined } = { current: undefined };
  const stack = await setupTestStackFromFeatures(
    toggles === undefined ? features : [...features, toggles.feature],
    {
      ...stackOptions,
      includeBundled,
      entityTables: registryTables,
      ...(toggles !== undefined && {
        effectiveFeatures: (tenantId: TenantId) => {
          if (toggleResolver.current === undefined) {
            throw new Error("feature-toggles: resolver not bound yet (boot order).");
          }
          return toggleResolver.current(tenantId);
        },
      }),
    },
  );
  try {
    if (registryTables) await pushEntityProjectionTables(stack, stack.registry);
    if (toggles !== undefined) {
      const bound = await toggles.bind({
        db: stack.db,
        registry: stack.registry,
        cacheSync: stack.cacheSync,
        tierResolver: undefined,
      });
      toggleResolver.current = bound.resolver;
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
