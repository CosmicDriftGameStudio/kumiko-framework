// Retention-preset-driven forget + policy-for (kumiko-framework#3283, Option B).
//
// Before this fix, forget (run-forget-cleanup.ts) and policy-for
// (policy-for.query.ts) resolved retention WITHOUT the tenant's
// compliance-profile-derived preset (Layer 2 of the 3-layer resolver): an
// entity with no own `retention` default (like `invoice`) fell straight to
// `source: "none"` -> policyToStrategy(null) -> "delete", hard-deleting data
// a mapped compliance profile (e.g. `de-hr-dsgvo-hgb`) requires to survive as
// blockDelete/anonymize. This proves the real end-to-end chain:
//   compliance-profiles:write:set-profile -> resolveProfileForTenant ->
//   resolveTenantRetentionPreset -> resolveRetentionPolicyForTenant ->
//   (forget) policyToStrategy / (policy-for query) EffectiveRetentionPolicy.source
//
// A test-only `invoice` entity stands in for the real dsgvo-hgb preset entry
// (RETENTION_PRESETS["dsgvo-hgb"].invoice = blockDelete/10y) since no bundled
// feature ships a real invoice entity.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import {
  ComplianceProfileHandlers,
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import {
  createDataRetentionFeature,
  resolveRetentionPolicyForTenant,
  tenantRetentionOverrideEntity,
  tenantRetentionOverrideTable,
} from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity, userTable } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
} from "./forget-test-helpers";

const POLICY_FOR = "data-retention:query:policy-for";
const CREATE_INVOICE = "test-invoice:write:create";
const INVOICE_TABLE = "read_test_retention_invoices";

// No own `retention` default -> Layer 1 is empty, so whether forget/policy-for
// see the preset (Layer 2) is exactly what's under test.
const invoiceEntity = createEntity({
  table: INVOICE_TABLE,
  fields: {
    amount: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});
const invoiceTable = buildEntityTable("invoice", invoiceEntity);
const invoiceCrud = createEventStoreExecutor(invoiceTable, invoiceEntity, {
  entityName: "invoice",
});

// Mirrors fileRefDeleteHook's executor-based pattern (forget writes go
// through events, not deleteMany/updateMany, so a projection rebuild replays
// the erasure): hard-delete on "delete", sever the owner-link on "anonymize".
const invoiceDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  const systemUser = createSystemUser(ctx.tenantId);
  const rows = await ctx.db.selectMany<{ id: string }>(invoiceTable, {
    tenantId: ctx.tenantId,
    insertedById: ctx.userId,
  });
  for (const row of rows) {
    if (strategy === "delete") {
      await invoiceCrud.forget({ id: row.id }, systemUser, ctx.db);
    } else {
      await invoiceCrud.update(
        { id: row.id, changes: { insertedById: null } },
        systemUser,
        ctx.db,
        {
          skipOptimisticLock: true,
        },
      );
    }
  }
};

const testInvoiceFeature: FeatureDefinition = defineFeature("test-invoice", (r) => {
  r.entity("invoice", invoiceEntity);
  const handlers = {
    create: r.writeHandler({
      name: "create",
      schema: z.object({ amount: z.string() }),
      access: { roles: access.authenticated },
      description: "test-only invoice creation for the retention-preset forget test",
      handler: async (event, ctx) =>
        invoiceCrud.create({ amount: event.payload.amount }, event.user, ctx.db),
    }),
  };
  r.useExtension(EXT_USER_DATA, "invoice", {
    export: async () => null,
    delete: invoiceDeleteHook,
  });
  return { handlers };
});

const TENANT_A = "00000000-0000-4000-8000-0000000000e1";
const TENANT_B = "00000000-0000-4000-8000-0000000000e2";
const FORGET_USER = "cccccccc-cccc-4ccc-8ccc-0000000000e1";

let stack: TestStack;
// biome-ignore lint/suspicious/noExplicitAny: dummy writer; this fixture has no binaries.
const seed = (db: unknown) => createForgetSeeders(db as any, { write: async () => {} });

function tenantAdmin(id: string, tenantId: string) {
  return createTestUser({ id, tenantId, roles: ["TenantAdmin"] });
}

async function fetchInvoice(
  id: string,
): Promise<{ id: string; inserted_by_id: string | null } | null> {
  const result = await asRawClient(stack.db).unsafe(
    `SELECT id, inserted_by_id FROM ${INVOICE_TABLE} WHERE id = $1`,
    [id],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  const rows = ((result as any).rows ?? result) as Array<{
    id: string;
    inserted_by_id: string | null;
  }>;
  return rows[0] ?? null;
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      testInvoiceFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, invoiceEntity, "invoice");
  await asRawClient(stack.db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    "read_tenant_memberships",
    invoiceTable,
    tenantRetentionOverrideTable,
    tenantComplianceProfileTable,
  ]);
});

describe("data-retention preset honored by forget + policy-for (kumiko-framework#3283)", () => {
  test("tenant with a mapped compliance profile -> invoice forget anonymizes (blockDelete preset); tenant without one -> hard-deleted", async () => {
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT_A);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT_B);

    const adminA = tenantAdmin("11111111-0000-4000-8000-0000000000e1", TENANT_A);
    await stack.http.writeOk(
      ComplianceProfileHandlers.setProfile,
      { profileKey: "de-hr-dsgvo-hgb" },
      adminA,
    );
    // Tenant B: no profile set -> control, unchanged hard-delete behavior.

    const invoiceUserA = { id: FORGET_USER, tenantId: TENANT_A, roles: ["User"] };
    const invoiceUserB = { id: FORGET_USER, tenantId: TENANT_B, roles: ["User"] };
    const invoiceA = await stack.http.writeOk<{ id: string }>(
      CREATE_INVOICE,
      { amount: "100.00" },
      invoiceUserA,
    );
    const invoiceB = await stack.http.writeOk<{ id: string }>(
      CREATE_INVOICE,
      { amount: "200.00" },
      invoiceUserB,
    );

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
    });
    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);

    const rowA = await fetchInvoice(invoiceA.id);
    expect(rowA).not.toBeNull();
    expect(rowA?.inserted_by_id).toBeNull();

    expect(await fetchInvoice(invoiceB.id)).toBeNull();
  });

  test("policy-for query reflects the same preset layer per tenant", async () => {
    const adminA = tenantAdmin("11111111-0000-4000-8000-0000000000e2", TENANT_A);
    const adminB = tenantAdmin("11111111-0000-4000-8000-0000000000e3", TENANT_B);
    await stack.http.writeOk(
      ComplianceProfileHandlers.setProfile,
      { profileKey: "de-hr-dsgvo-hgb" },
      adminA,
    );

    const resultA = await stack.http.queryOk<{
      source: string;
      policy: { strategy: string } | null;
    }>(POLICY_FOR, { entityName: "invoice" }, adminA);
    expect(resultA.source).toBe("preset");
    expect(resultA.policy?.strategy).toBe("blockDelete");

    const resultB = await stack.http.queryOk<{ source: string }>(
      POLICY_FOR,
      { entityName: "invoice" },
      adminB,
    );
    expect(resultB.source).not.toBe("preset");
  });

  test("resolveRetentionPolicyForTenant resolves the preset through a TenantDb, not just a bulk DbRunner", async () => {
    const adminC = tenantAdmin("11111111-0000-4000-8000-0000000000e4", TENANT_A);
    await stack.http.writeOk(
      ComplianceProfileHandlers.setProfile,
      { profileKey: "de-hr-dsgvo-hgb" },
      adminC,
    );

    const tenantDb: TenantDb = createTenantDb(stack.db, TENANT_A, "tenant");
    const policy = await resolveRetentionPolicyForTenant({
      db: tenantDb,
      registry: stack.registry,
      tenantId: TENANT_A,
      entityName: "invoice",
    });
    expect(policy.source).toBe("preset");
    expect(policy.policy?.strategy).toBe("blockDelete");
  });
});
