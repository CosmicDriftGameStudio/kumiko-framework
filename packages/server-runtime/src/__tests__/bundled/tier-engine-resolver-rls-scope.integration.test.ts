// The resolver is built outside any request, on the enforcing pool (stack.unscopedDb),
// exactly like the prod boot; stack.db would hide the bug because it is system-scoped.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configValuesTable } from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantSecretsTable } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { tenantMembershipsTable, tenantTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenant } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import type { TierMap } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import {
  createTierEngineFeature,
  tierAssignmentEntity,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type EffectiveFeaturesResolver,
  type FeatureDefinition,
  findTierResolverUsage,
  isTierResolverPlugin,
  type TenantId,
  type TierResolverPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import { CACHE_SYNC_TOPICS } from "@cosmicdrift/kumiko-framework/redis";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";

const TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: ["feat-pro"], caps: { maxItems: 5 } },
};
const PRO_FEATURE = "feat-pro";

const featProFeature = defineFeature(PRO_FEATURE, (r) => {
  r.toggleable({ default: false });
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    handler: async () => ({ ok: true }),
    access: { roles: ["TenantAdmin"] },
  });
});

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
const preloadedTenant = "00000000-0000-4000-8000-0000000000d1" as TenantId;
const reloadedTenant = "00000000-0000-4000-8000-0000000000d2" as TenantId;
const trialTenant = "00000000-0000-4000-8000-0000000000d3" as TenantId;
const sysUser = createTestUser({
  id: "sys-rls",
  tenantId: preloadedTenant,
  roles: ["SystemAdmin", "TenantAdmin"],
});

function pluginOf(features: readonly FeatureDefinition[]): TierResolverPlugin {
  const usage = findTierResolverUsage(features);
  if (!usage || !isTierResolverPlugin(usage.options)) {
    throw new Error("setup failure: no tier-resolver plugin registered");
  }
  return usage.options;
}

describe("tier resolver under row-level security", () => {
  let stack: TestStack;
  let trialResolver: EffectiveFeaturesResolver;

  const buildOnEnforcingPool = (plugin: TierResolverPlugin) =>
    plugin.build({
      db: stack.unscopedDb,
      registry: stack.registry,
      cacheSync: stack.cacheSync,
    });

  const setTier = (tenantId: TenantId, tier: string) =>
    stack.http.writeOk("tier-engine:write:set-tenant-tier", { tenantId, tier }, sysUser);

  beforeAll(async () => {
    const features = composeFeatures(
      [
        createTierEngineFeature({
          tierMap: TIER_MAP,
          defaultTier: "free",
          trial: { tier: "pro", durationHours: 24 },
        }),
        featProFeature,
      ],
      { includeBundled: true },
    );
    stack = await setupTestStack({ features, cacheSync: true });
    await unsafePushTables(stack.db, {
      config_values: configValuesTable,
      users: userTable,
      tenants: tenantTable,
      tenant_memberships: tenantMembershipsTable,
      tenant_secrets: tenantSecretsTable,
      tier_assignments: tierAssignmentTable,
    });
    await setTier(preloadedTenant, "pro");
    trialResolver = await buildOnEnforcingPool(pluginOf(features));
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("the boot preload keeps a manually assigned tier", async () => {
    // A fresh feature instance has an empty cache, so only the preload can fill it.
    const bootResolver = await buildOnEnforcingPool(
      pluginOf([createTierEngineFeature({ tierMap: TIER_MAP, defaultTier: "free" })]),
    );

    expect(bootResolver(preloadedTenant).has(PRO_FEATURE)).toBe(true);
  });

  test("a bus-driven reload picks up a tier assigned on another pod", async () => {
    const reloadingResolver = await buildOnEnforcingPool(
      pluginOf([createTierEngineFeature({ tierMap: TIER_MAP, defaultTier: "free" })]),
    );
    expect(reloadingResolver(reloadedTenant).has(PRO_FEATURE)).toBe(false);

    await setTier(reloadedTenant, "pro");
    stack.cacheSync.publish(CACHE_SYNC_TOPICS.tierAssignment, { tenantId: reloadedTenant });

    await waitFor(async () => reloadingResolver(reloadedTenant).has(PRO_FEATURE));
  });

  test("the trial gate reads the tenant creation time", async () => {
    await seedTenant(stack.db, { id: trialTenant, key: "rls-trial", name: "Trial" });
    const trialGate = trialResolver.trialGate;
    if (!trialGate) throw new Error("setup failure: trial option did not attach a trialGate");

    expect(await trialGate(trialTenant, PRO_FEATURE)).toBe(true);
  });
});
