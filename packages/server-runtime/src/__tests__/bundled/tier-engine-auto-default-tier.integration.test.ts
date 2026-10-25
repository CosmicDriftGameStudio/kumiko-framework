// auto-default-tier hook regression test: `tenant:write:create` must fire the postSave hook of
// createTierEngineFeature, which writes a tier-assignment row with `defaultTier`.
//
// Why this test exists: the hook was never tested directly, and a bug surfaced later:
// `ctx.db as DbConnection` was a type lie. TenantDb exposes select/insert/update/delete, NOT
// execute(), but the event-store append calls `db.execute(sql\`SELECT pg_notify(...)\`)` and
// threw a TypeError. Fix: `ctx.db.raw as DbConnection` (same pattern as signup-confirm.write.ts).
//
// Pinned contracts:
//   1. tenant:write:create fires the postSave hook with isNew=true
//   2. The hook creates the tier-assignment row in the NEW tenant, not in the caller tenant
//   3. Idempotency: a tenant update does not create another row
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configValuesTable } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  TenantHandlers,
  tenantMembershipsTable,
  tenantTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { TierMap } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import {
  createTierEngineFeature,
  tierAssignmentEntity,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";

const TEST_TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
};

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

const features = composeFeatures(
  [createTierEngineFeature({ defaultTier: "free", tierMap: TEST_TIER_MAP })],
  { includeBundled: true },
);

let stack: TestStack;
const PLATFORM_TENANT = "00000000-0000-4000-8000-000000000001";
const sysadmin = createTestUser({
  id: "platform-sysadmin",
  tenantId: PLATFORM_TENANT,
  roles: ["SystemAdmin"],
});

beforeAll(async () => {
  stack = await setupTestStack({ features });
  await unsafePushTables(stack.db, {
    config_values: configValuesTable,
    users: userTable,
    tenants: tenantTable,
    tenant_memberships: tenantMembershipsTable,
    tier_assignments: tierAssignmentTable,
  });
});

afterAll(async () => stack?.cleanup());

describe("auto-default-tier postSave hook on tenant-create", () => {
  test("sysadmin creates a new tenant → free tier-assignment-row angelegt", async () => {
    const data = (await stack.http.writeOk<Record<string, unknown>>(
      TenantHandlers.create,
      { key: "test-tenant-1", name: "Test Tenant One" },
      sysadmin,
    ))!;
    const newTenantId = data["id"] as string;
    expect(typeof newTenantId).toBe("string");

    const rows = await selectMany(stack.db, tierAssignmentTable, { tenantId: newTenantId });
    expect(rows.length).toBe(1);
    expect((rows[0] as Record<string, unknown>)["tier"]).toBe("free");
  });

  test("idempotency: tenant-update does not fire another tier-assignment-row", async () => {
    const created = (await stack.http.writeOk<Record<string, unknown>>(
      TenantHandlers.create,
      { key: "test-tenant-2", name: "Test Tenant Two" },
      sysadmin,
    ))!;
    const tenantId = created["id"] as string;

    const existing = (await selectMany(stack.db, tenantTable, { id: tenantId })) as Array<{
      id: string;
      version: number;
    }>;
    const currentVersion = existing[0]!.version;

    await stack.http.writeOk(
      TenantHandlers.update,
      {
        id: tenantId,
        version: currentVersion,
        changes: { name: "Test Tenant Two — Renamed" },
      },
      sysadmin,
    );

    const rows = await selectMany(stack.db, tierAssignmentTable, { tenantId: tenantId });
    expect(rows.length).toBe(1);
  });
});
