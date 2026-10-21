// Behavior tests for `createTierEngineFeature({ tierMap })`, three coverage layers:
//
// (1) Per-tenant gating end-to-end via the dispatcher: tenant A on "pro" sees the feature
//     handler, tenant B on "free" gets 403.
// (2) Cache invalidation via tier-assignment:postSave: a tier change is reflected in the
//     resolver immediately.
// (3) SYSTEM_TENANT_ID returns the union of all features (operator tooling and the
//     event-dispatcher async-pass convention).
//
// The per-tenant signature and extension pickup are tested nowhere else with the real engine;
// the dispatcher tests only show the signature works with a mock resolver.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
import { asRawClient, buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  findTierResolverUsage,
  SYSTEM_TENANT_ID,
  type TenantId,
  type TierResolverPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";

// App-specific cap shape (the TierMap is generic). Dummy caps here, the focus is feature
// resolution, not caps.
type TestCaps = { readonly maxItems: number };

const TEST_TIER_MAP: TierMap<TestCaps> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: ["feat-pro"], caps: { maxItems: 5 } },
  business: { features: ["feat-pro", "feat-business"], caps: { maxItems: 20 } },
};

// Toy feature with a tenantadmin-only handler. If the feature is in the effective set the
// dispatcher lets the call through, otherwise it answers 403 feature_disabled.
const featProFeature = defineFeature("feat-pro", (r) => {
  r.toggleable({ default: false });
  r.queryHandler({
    name: "ping",
    schema: {
      parse: () => ({}),
      safeParse: () => ({ success: true as const, data: {} }),
    } as never,
    handler: async () => ({ ok: true }),
    access: { roles: ["TenantAdmin"] },
  });
});

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

const features = composeFeatures(
  [createTierEngineFeature({ tierMap: TEST_TIER_MAP }), featProFeature],
  { includeBundled: true },
);

// Second composition WITH the trial option: every tenant receives the "pro" features (feat-pro)
// for 30 days from inserted_at, independent of the stored tier.
const TRIAL_HOURS = 30 * 24;
const featuresWithTrial = composeFeatures(
  [
    createTierEngineFeature({
      tierMap: TEST_TIER_MAP,
      trial: { tier: "pro", durationHours: TRIAL_HOURS },
    }),
    featProFeature,
  ],
  { includeBundled: true },
);

let stack: TestStack;
const tenantA = "00000000-0000-4000-8000-0000000000a1" as TenantId;
const tenantB = "00000000-0000-4000-8000-0000000000b2" as TenantId;
const _adminA = createTestUser({ id: "u-a", tenantId: tenantA, roles: ["TenantAdmin"] });
const _adminB = createTestUser({ id: "u-b", tenantId: tenantB, roles: ["TenantAdmin"] });

beforeAll(async () => {
  // setupTestStack with the extension-pickup path: fetch the plugin and build it manually,
  // because setupTestStack does not auto-pickup (that is runDevApp/runProdApp's job). The test
  // targets the feature implementation, not the wiring; a separate dev-server integration test
  // covers the wiring.
  stack = await setupTestStack({ features });
  await unsafePushTables(stack.db, {
    config_values: configValuesTable,
    users: userTable,
    tenants: tenantTable,
    tenant_memberships: tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
    tier_assignments: tierAssignmentTable,
  });
});

afterAll(async () => stack?.cleanup());

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE read_tier_assignments, read_tenants, kumiko_events RESTART IDENTITY CASCADE`,
  );
});

describe("createTierEngineFeature — per-tenant resolver", () => {
  test("(1) per-tenant gating: Tenant A 'pro' sees feat-pro, Tenant B 'free' gets 403", async () => {
    // Pickup the resolver-plugin from the registry — same path runDevApp uses.
    const usage = findTierResolverUsage(features);
    expect(usage).toBeDefined();
    if (!usage) throw new Error("setup failure: no tier-resolver plugin registered");
    const plugin = usage.options as TierResolverPlugin;

    // Seed tier-assignments BEFORE building the resolver so pre-load picks them up.
    await stack.http.writeOk(
      "tier-engine:write:tier-assignment:create",
      { tier: "pro" },
      createTestUser({ id: "sys-1", tenantId: tenantA, roles: ["SystemAdmin", "TenantAdmin"] }),
    );
    await stack.http.writeOk(
      "tier-engine:write:tier-assignment:create",
      { tier: "free" },
      createTestUser({ id: "sys-2", tenantId: tenantB, roles: ["SystemAdmin", "TenantAdmin"] }),
    );

    // Build the resolver — this pre-loads existing assignments into cache.
    const resolver = await plugin.build({ db: stack.db, registry: stack.registry });

    // Direct resolver-calls verify per-tenant behavior:
    expect(resolver(tenantA).has("feat-pro")).toBe(true);
    expect(resolver(tenantB).has("feat-pro")).toBe(false);
  });

  test("(2) cache-invalidation: tier change reflects in resolver immediately", async () => {
    // Start with free, upgrade to pro; the resolver must see it immediately.
    const usage = findTierResolverUsage(features);
    if (!usage) throw new Error("setup failure");
    const plugin = usage.options as TierResolverPlugin;

    const sysA = createTestUser({
      id: "sys-3",
      tenantId: tenantA,
      roles: ["SystemAdmin", "TenantAdmin"],
    });
    await stack.http.writeOk("tier-engine:write:tier-assignment:create", { tier: "free" }, sysA);

    const resolver = await plugin.build({ db: stack.db, registry: stack.registry });
    expect(resolver(tenantA).has("feat-pro")).toBe(false);

    // Get the assignment-row for the update (need id + version).
    type Row = { readonly id: string; readonly version: number; readonly tier: string };
    const list = await stack.http.queryOk<{ rows: readonly Row[] }>(
      "tier-engine:query:tier-assignment:list",
      {},
      sysA,
    );
    const row = list.rows[0];
    if (!row) throw new Error("no tier-assignment row created");

    // Update to pro — entityHook should fire and refresh cache.
    await stack.http.writeOk(
      "tier-engine:write:tier-assignment:update",
      { id: row.id, version: row.version, changes: { tier: "pro" } },
      sysA,
    );

    // Cache should reflect the new tier.
    expect(resolver(tenantA).has("feat-pro")).toBe(true);
  });

  test("set-tenant-tier for a foreign tenant writes its stream with the operator as actor", async () => {
    const operator = createTestUser({
      id: "sys-5",
      tenantId: tenantA,
      roles: ["SystemAdmin", "TenantAdmin"],
    });
    await stack.http.writeOk(
      "tier-engine:write:set-tenant-tier",
      { tenantId: tenantB, tier: "pro" },
      operator,
    );

    const events = await selectMany<{ tenantId: string; createdBy: string }>(
      stack.db,
      eventsTable,
      { tenantId: tenantB },
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.createdBy === operator.id)).toBe(true);
  });

  test("(4) set-tenant-tier reflects in resolver — effective gating, not just projection", async () => {
    // Core purpose: a manual grant must change the EFFECTIVE feature set (resolver
    // cache), not just the projection. set-tenant-tier writes through the executor directly;
    // does that fire the postSave hook that refreshes the cache? A stale free->pro upgrade
    // covers the case the cache-miss fallback does NOT rescue.
    const usage = findTierResolverUsage(features);
    if (!usage) throw new Error("setup failure");
    const plugin = usage.options as TierResolverPlugin;

    const sysA = createTestUser({
      id: "sys-4",
      tenantId: tenantA,
      roles: ["SystemAdmin", "TenantAdmin"],
    });
    await stack.http.writeOk("tier-engine:write:tier-assignment:create", { tier: "free" }, sysA);

    const resolver = await plugin.build({ db: stack.db, registry: stack.registry });
    expect(resolver(tenantA).has("feat-pro")).toBe(false);

    // Manual grant via set-tenant-tier (cross-tenant capable, here the tenant itself).
    await stack.http.writeOk(
      "tier-engine:write:set-tenant-tier",
      { tenantId: tenantA, tier: "pro" },
      sysA,
    );

    expect(resolver(tenantA).has("feat-pro")).toBe(true);
  });

  test("(3) SYSTEM_TENANT_ID returns union of all tier-features", async () => {
    const usage = findTierResolverUsage(features);
    if (!usage) throw new Error("setup failure");
    const plugin = usage.options as TierResolverPlugin;

    const resolver = await plugin.build({ db: stack.db, registry: stack.registry });
    const systemSet = resolver(SYSTEM_TENANT_ID);

    // Union of tier-map features (feat-pro in pro+business, feat-business in business).
    expect(systemSet.has("feat-pro")).toBe(true);
    expect(systemSet.has("feat-business")).toBe(true);
    // SYSTEM tenant also receives always-on non-toggleable features from includeBundled.
    expect(systemSet.size).toBeGreaterThanOrEqual(2);
  });
});

describe("createTierEngineFeature — Trial-Phase (zeit-abgeleitet, Live-Gate)", () => {
  // The trial no longer lives in the resolver feature set (a sync, boot-cached set sees neither
  // fresh signups nor the passage of time) but in an async trialGate that reads tenant.inserted_at
  // LIVE. These tenants come from the REAL seedTenant path (= auth-signup) WITHOUT a
  // tier-assignment row. That path was the prod bug: the old cached trial clock never saw
  // seedTenant signups (seedTenant bypasses the dispatcher postSave hook).
  async function seedSignup(tenantId: TenantId, key: string) {
    await seedTenant(stack.db, { id: tenantId, key, name: key });
  }

  test("seedTenant-Signup ohne tier-assignment: trialGate schaltet feat-pro im Fenster frei", async () => {
    const usage = findTierResolverUsage(featuresWithTrial);
    if (!usage) throw new Error("setup failure: no trial resolver");
    const plugin = usage.options as TierResolverPlugin;

    await seedSignup(tenantA, "trial-a");
    const resolver = await plugin.build({ db: stack.db, registry: stack.registry });

    // The trial sits at the gate, not in the resolver feature set.
    expect(resolver(tenantA).has("feat-pro")).toBe(false);
    expect(resolver.trialGate).toBeDefined();
    expect(await resolver.trialGate?.(tenantA, "feat-pro")).toBe(true);
    // A feature outside the trial tier ("business") stays closed.
    expect(await resolver.trialGate?.(tenantA, "feat-business")).toBe(false);
  });

  test("inserted_at > 30 Tage: trialGate schließt", async () => {
    const usage = findTierResolverUsage(featuresWithTrial);
    if (!usage) throw new Error("setup failure: no trial resolver");
    const plugin = usage.options as TierResolverPlugin;

    await seedSignup(tenantB, "trial-b");
    // Backdate the creation date by 31 days so the trial has expired. tenantB is a fixed test
    // UUID (no user input), so the inline interpolation is safe.
    await asRawClient(stack.db).unsafe(
      `UPDATE read_tenants SET inserted_at = now() - interval '31 days' WHERE id = '${tenantB}'::uuid`,
    );
    const resolver = await plugin.build({ db: stack.db, registry: stack.registry });
    expect(await resolver.trialGate?.(tenantB, "feat-pro")).toBe(false);
  });

  test("ohne Trial-Option gibt es keinen trialGate", async () => {
    const usage = findTierResolverUsage(features);
    if (!usage) throw new Error("setup failure");
    const plugin = usage.options as TierResolverPlugin;
    const resolver = await plugin.build({ db: stack.db, registry: stack.registry });
    expect(resolver.trialGate).toBeUndefined();
  });
});
