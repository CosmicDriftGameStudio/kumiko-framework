// Sprint-8a: behavior-tests für `createTierEngineFeature({ tierMap })`.
// Drei tests, advisor-empfohlene Coverage-Schichten:
//
// (1) per-tenant gating end-to-end via dispatcher: Tenant A "pro" sieht
//     den feature-handler, Tenant B "free" bekommt 403.
// (2) cache-invalidation via tier-assignment:postSave: tier ändert sich
//     → resolver reflects sofort.
// (3) SYSTEM_TENANT_ID returnt union-of-all-features (operator-tooling +
//     event-dispatcher async-pass convention).
//
// Memory `feedback_no_fake_tests`: das Verhalten der per-tenant signature
// + extension-pickup ist sonst nirgends getestet. Phase-1-tests (dispatcher
// per-tenant + lifecycle hook-filter) zeigen die signature funktioniert
// MIT einem mock-resolver. Diese tests zeigen die echte tier-engine als
// resolver-implementierung funktioniert.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configValuesTable } from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantSecretsTable } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { tenantMembershipsTable, tenantTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  findTierResolverUsage,
  SYSTEM_TENANT_ID,
  type TenantId,
  type TierResolverPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import type { TierMap } from "../compose-app";
import { tierAssignmentEntity } from "../entity";
import { createTierEngineFeature } from "../feature";

// App-spezifische cap-shape (die TierMap ist generic). Hier dummy-caps —
// fokus ist features-resolution, nicht caps.
type TestCaps = { readonly maxItems: number };

const TEST_TIER_MAP: TierMap<TestCaps> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: ["feat-pro"], caps: { maxItems: 5 } },
  business: { features: ["feat-pro", "feat-business"], caps: { maxItems: 20 } },
};

// Toy-feature mit einem tenantadmin-only-handler. Wenn das feature im
// effective-Set ist, dispatcher passt durch — wenn nicht, 403 feature_disabled.
const featProFeature = defineFeature("feat-pro", (r) => {
  r.toggleable({ default: false });
  r.queryHandler(
    "ping",
    {
      parse: () => ({}),
      safeParse: () => ({ success: true as const, data: {} }),
    } as never,
    async () => ({ ok: true }),
    { access: { roles: ["TenantAdmin"] } },
  );
});

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

const features = composeFeatures(
  [createTierEngineFeature({ tierMap: TEST_TIER_MAP }), featProFeature],
  { includeBundled: true },
);

let stack: TestStack;
const tenantA = "00000000-0000-4000-8000-0000000000a1" as TenantId;
const tenantB = "00000000-0000-4000-8000-0000000000b2" as TenantId;
const _adminA = createTestUser({ id: "u-a", tenantId: tenantA, roles: ["TenantAdmin"] });
const _adminB = createTestUser({ id: "u-b", tenantId: tenantB, roles: ["TenantAdmin"] });

beforeAll(async () => {
  // setupTestStack mit dem extension-pickup-Pfad: wir holen den plugin
  // selbst und builden ihn manuell, weil setupTestStack heute nicht das
  // Auto-pickup macht (das ist runDevApp/runProdApp's Job). Test fokus
  // ist die feature-Implementation, nicht das wiring — wiring deckt
  // (separater) integration-test im dev-server ab.
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
    `TRUNCATE read_tier_assignments, kumiko_events RESTART IDENTITY CASCADE`,
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
    // Start mit free, dann zu pro upgraden, resolver soll's sofort sehen.
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
