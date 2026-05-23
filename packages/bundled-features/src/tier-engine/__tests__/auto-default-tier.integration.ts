// auto-default-tier hook regression test — beweist dass beim
// `tenant:write:create` der postSave-Hook von createTierEngineFeature
// fired und automatisch ein tier-assignment-row mit `defaultTier`
// schreibt.
//
// **Warum dieser Test existiert (2026-05-10):**
// Der auto-default-tier-Hook wurde in Sprint 8a Phase 2 hinzugefügt aber
// nie direkt getestet. Bei Sprint 8c (Studio-Mount mit auto-default-
// compliance-companion-hook) flog der Bug auf: `ctx.db as DbConnection`
// war ein Type-Lie — TenantDb exposed select/insert/update/delete, NICHT
// execute(). Der event-store-append (event-store.ts:102) ruft
// `db.execute(sql\`SELECT pg_notify(...)\`)` → TypeError. Fix:
// `ctx.db.raw as DbConnection` (Pattern aus signup-confirm.write.ts:107).
//
// Pin-Verträge:
//   1. tenant:write:create fired postSave-Hook mit isNew=true
//   2. Hook erstellt tier-assignment-row im NEUEN tenant (nicht im caller-
//      tenant — Memory `feedback_event_store_tenant_consistency`)
//   3. Idempotency: tenant-update fired keinen weiteren row

import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { configValuesTable } from "../../config";
import { TenantHandlers, tenantMembershipsTable, tenantTable } from "../../tenant";
import { userTable } from "../../user";
import type { TierMap } from "../compose-app";
import { tierAssignmentEntity } from "../entity";
import { createTierEngineFeature } from "../feature";

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

  test("idempotency: tenant-update fired keinen weiteren tier-assignment-row", async () => {
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
