// Tier Admin — integration test.
//
// Drives the SystemAdmin-only operator flow end-to-end against the real
// dispatcher + DB:
//   1. SystemAdmin sits in his own tenant.
//   2. He grants a tier to a FOREIGN tenant via set-tenant-tier.
//   3. get-tenant-tier (cross-tenant read) returns tier:"pro",
//      source:"manual" — proving the grant landed in the target stream
//      and is marked as a manual grant (Stripe sync won't overwrite it).
//   4. tier-options returns the TierMap keys without hard-coding.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createTenantFeature, tenantEntity } from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  TierEngineHandlers,
  TierEngineQueries,
  tierAssignmentEntity,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { asRawClient, createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { appTierMap, tierEngineForApp } from "../feature";

const encryptionKey = randomBytes(32).toString("base64");
const configFeature = createConfigFeature();
const tenantFeature = createTenantFeature();

let stack: TestStack;

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [configFeature, tenantFeature, tierEngineForApp],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(
    "TRUNCATE read_tier_assignments, kumiko_events RESTART IDENTITY CASCADE",
  );
});

type GrantResult = { tenantId: string; tier: string; isNew: boolean };
type GrantRow = { tier: string; source: string };
type Options = { tiers: ReadonlyArray<string> };

test("SystemAdmin grants a foreign tenant the 'pro' tier without billing", async () => {
  const adminTenant = testTenantId(1);
  const targetTenant = testTenantId(2);
  const sysadmin = createTestUser({ id: 1, tenantId: adminTenant, roles: ["SystemAdmin"] });

  // (1) Grant — cross-tenant write. SystemAdmin sits in adminTenant, the
  // tier-assignment event lands in targetTenant's stream.
  const grant = await stack.http.writeOk<GrantResult>(
    TierEngineHandlers.setTenantTier,
    { tenantId: targetTenant, tier: "pro" },
    sysadmin,
  );
  expect(grant.tenantId).toBe(targetTenant);
  expect(grant.tier).toBe("pro");
  expect(grant.isNew).toBe(true);

  // (2) Read-back via get-tenant-tier — cross-tenant query. source:"manual"
  // is the load-bearing field: it tells a future Stripe → tier sync NOT
  // to overwrite the operator-set tier.
  const row = await stack.http.queryOk<GrantRow>(
    TierEngineQueries.getTenantTier,
    { tenantId: targetTenant },
    sysadmin,
  );
  expect(row.tier).toBe("pro");
  expect(row.source).toBe("manual");
});

test("tier-options returns the configured TierMap keys (no hard-coding)", async () => {
  const sysadmin = createTestUser({
    id: 2,
    tenantId: testTenantId(3),
    roles: ["SystemAdmin"],
  });

  const opts = await stack.http.queryOk<Options>(TierEngineQueries.tierOptions, {}, sysadmin);

  expect(opts.tiers).toEqual(Object.keys(appTierMap));
});

test("upsert is idempotent — re-granting updates the same aggregate", async () => {
  const sysadmin = createTestUser({
    id: 3,
    tenantId: testTenantId(4),
    roles: ["SystemAdmin"],
  });
  const target = testTenantId(5);

  const first = await stack.http.writeOk<GrantResult>(
    TierEngineHandlers.setTenantTier,
    { tenantId: target, tier: "free" },
    sysadmin,
  );
  expect(first.isNew).toBe(true);

  const second = await stack.http.writeOk<GrantResult>(
    TierEngineHandlers.setTenantTier,
    { tenantId: target, tier: "pro" },
    sysadmin,
  );
  expect(second.isNew).toBe(false);
  expect(second.tier).toBe("pro");
});

test("TenantAdmin without SystemAdmin role cannot grant a foreign tenant a tier", async () => {
  const tenantAdmin = createTestUser({
    id: 4,
    tenantId: testTenantId(6),
    roles: ["TenantAdmin"],
  });
  const target = testTenantId(7);

  const res = await stack.http.write(
    TierEngineHandlers.setTenantTier,
    { tenantId: target, tier: "pro" },
    tenantAdmin,
  );
  expect(res.status).toBe(403);
});
