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
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
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
};

export async function setupAppTestStack(
  features: readonly FeatureDefinition[],
  options: SetupAppTestStackOptions = {},
): Promise<TestStack> {
  const { registryTables = true, includeBundled = true, ...stackOptions } = options;
  const stack = await setupTestStackFromFeatures(features, {
    ...stackOptions,
    includeBundled,
    entityTables: registryTables,
  });
  if (!registryTables) return stack;
  try {
    await pushEntityProjectionTables(stack, stack.registry);
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
