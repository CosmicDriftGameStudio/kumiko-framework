// createTierResolver (fw#2854): resolveTier/resolveTierCaps take only a
// TenantDb — the tenant comes from db.tenantId, so a caller can't request a
// foreign tenant's tier. Proves defaultTier for an unassigned tenant, the
// assigned tier for an assigned one, and the same behavior end-to-end
// through a TenantAdmin-only query handler with no escapeHatch.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configValuesTable } from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantSecretsTable } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { tenantMembershipsTable, tenantTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import * as z from "zod";
import { tierAssignmentEntity } from "../entity";
import { tierEngineFeature } from "../feature";
import { createTierResolver } from "../tier-resolver";

type TestCaps = { readonly maxItems: number };
type TestTier = "free" | "pro";

function isTestTierName(value: string): value is TestTier {
  return value === "free" || value === "pro";
}

function capsForTier(tier: TestTier): TestCaps {
  return tier === "pro" ? { maxItems: 5 } : { maxItems: 1 };
}

const { resolveTier, resolveTierCaps } = createTierResolver<TestTier, TestCaps>({
  capsForTier,
  isTierName: isTestTierName,
  defaultTier: "free",
});

const RESOLVED_CAPS_QN = "resolver-probe:query:resolved-caps";
const resolverProbeFeature = defineFeature("resolver-probe", (r) => {
  r.queryHandler({
    name: "resolved-caps",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async (_query, ctx) => resolveTierCaps(ctx.db),
  });
});

const features = composeFeatures([tierEngineFeature, resolverProbeFeature], {
  includeBundled: true,
});

// Same underlying table createTierResolver builds internally — pushed here
// so the schema exists before the write-handler + resolver read it.
const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

let stack: TestStack;
const tenantA = "00000000-0000-4000-8000-0000000000c1" as TenantId;
const tenantB = "00000000-0000-4000-8000-0000000000c2" as TenantId;

beforeAll(async () => {
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
  await asRawClient(stack.db).unsafe(`TRUNCATE read_tier_assignments RESTART IDENTITY CASCADE`);
});

function sysAdminFor(tenantId: TenantId) {
  return createTestUser({ id: `sys-${tenantId}`, tenantId, roles: ["SystemAdmin", "TenantAdmin"] });
}

function tenantAdminOnlyFor(tenantId: TenantId) {
  return createTestUser({ id: `admin-${tenantId}`, tenantId, roles: ["TenantAdmin"] });
}

async function assignTier(tenantId: TenantId, tier: TestTier): Promise<void> {
  await stack.http.writeOk(
    "tier-engine:write:tier-assignment:create",
    { tier },
    sysAdminFor(tenantId),
  );
}

describe("createTierResolver — resolveTier/resolveTierCaps", () => {
  test("unassigned tenant B resolves to defaultTier, not tenant A's assigned tier", async () => {
    await assignTier(tenantA, "pro");

    const tierA = await resolveTier(createTenantDb(stack.db, tenantA));
    expect(tierA).toBe("pro");

    const tierB = await resolveTier(createTenantDb(stack.db, tenantB));
    expect(tierB).toBe("free");
  });

  test("resolveTierCaps maps the resolved tier via capsForTier", async () => {
    await assignTier(tenantA, "pro");

    const capsA = await resolveTierCaps(createTenantDb(stack.db, tenantA));
    expect(capsA).toEqual({ maxItems: 5 });

    const capsB = await resolveTierCaps(createTenantDb(stack.db, tenantB));
    expect(capsB).toEqual({ maxItems: 1 });
  });

  test("end-to-end via a TenantAdmin-only query handler (no escapeHatch)", async () => {
    await assignTier(tenantA, "pro");

    const capsA = await stack.http.queryOk<TestCaps>(
      RESOLVED_CAPS_QN,
      {},
      tenantAdminOnlyFor(tenantA),
    );
    expect(capsA).toEqual({ maxItems: 5 });

    const capsB = await stack.http.queryOk<TestCaps>(
      RESOLVED_CAPS_QN,
      {},
      tenantAdminOnlyFor(tenantB),
    );
    expect(capsB).toEqual({ maxItems: 1 });
  });
});
