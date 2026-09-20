// fw#2914 — proves the escapeHatch declaration gate, not just its type.
//
// TenantDataHookCtx/UserDataHookCtx.db is a tenant-filtered TenantDb. A hook
// that declares `escapeHatch: { reason }` on its `r.useExtension(...)`
// registration can call `ctx.db.unsafeRaw(reason)` to get a REAL unfiltered
// DbRunner — the two tests below use it with a deliberately filter-less
// `DELETE FROM <table>` (no WHERE at all) to prove the grant is genuinely
// unfiltered, not merely present. A sibling hook that forgot to declare
// escapeHatch gets `AccessDeniedError` from that same call instead, which
// `runForgetCleanup` catches into `result.errors` — the row is left
// untouched rather than silently wiped/leaked across tenants.
//
// Pre-fix (TenantDataHookCtx/UserDataHookCtx.db was a raw, unfiltered
// DbRunner) BOTH hooks below — declared or not — could run this exact
// unfiltered DELETE with no gate at all. That's the regression this test
// pins shut.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
} from "./forget-test-helpers";

const FORGET_USER = "eeeeeeee-eeee-4eee-8eee-000000000001";
const TENANT_A = "00000000-0000-4000-8000-0000000000e1";
const TENANT_B_FOREIGN = "00000000-0000-4000-8000-0000000000e2";

const seed = (db: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: dummy file-writer; these seeders never write binaries.
  createForgetSeeders(db as any, { write: async () => {} });

function baseFeatures(): NonNullable<Parameters<typeof setupTestStack>[0]["features"]> {
  return [
    createUserFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    authFoundationFeature,
    createSessionsFeature(),
    createUserDataRightsFeature(),
  ];
}

async function bootBaseTables(stack: TestStack): Promise<void> {
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await asRawClient(stack.db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
}

describe("escape-hatch declaration :: declared hook gets a real unfiltered DbRunner", () => {
  const DECLARED_REASON =
    "fw#2914 test: escape-hatch declared on r.useExtension — ctx.db.unsafeRaw(reason) must grant a real unfiltered DbRunner";

  const declaredLeakHook: UserDataDeleteHook = async (ctx) => {
    // No WHERE clause at all — only possible with a genuinely unfiltered runner.
    await asRawClient(ctx.db.unsafeRaw(DECLARED_REASON)).unsafe(`DELETE FROM test_leaky_declared`);
  };

  const declaredFeature = defineFeature("test-leaky-declared", (r) => {
    r.useExtension(EXT_USER_DATA, "leaky-declared", {
      export: async () => null,
      delete: declaredLeakHook,
      escapeHatch: { reason: DECLARED_REASON },
    });
  });

  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [...baseFeatures(), declaredFeature] });
    await bootBaseTables(stack);
    await asRawClient(stack.db).unsafe(`
      CREATE TABLE IF NOT EXISTS test_leaky_declared (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL,
        secret TEXT NOT NULL
      )
    `);
    await asRawClient(stack.db).unsafe(
      `INSERT INTO test_leaky_declared (id, tenant_id, secret) VALUES
        ('11111111-1111-4111-8111-000000000001', $1, 'tenant-a-secret'),
        ('11111111-1111-4111-8111-000000000002', $2, 'tenant-b-secret')`,
      [TENANT_A, TENANT_B_FOREIGN],
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("declared unsafeRaw wipes rows across every tenant, not just the forgotten user's own", async () => {
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT_A);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
    });

    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);

    const remaining = await asRawClient(stack.db).unsafe(`SELECT id FROM test_leaky_declared`);
    // Both Tenant A's own row AND the foreign Tenant B's row are gone —
    // proves ctx.db.unsafeRaw(reason) really is unfiltered, not just granted.
    expect(remaining).toHaveLength(0);
  });
});

describe("escape-hatch declaration :: undeclared hook is denied, not silently unfiltered", () => {
  const UNDECLARED_REASON =
    "fw#2914 test: escape-hatch NOT declared on r.useExtension — ctx.db.unsafeRaw(reason) must be denied";

  const undeclaredLeakHook: UserDataDeleteHook = async (ctx) => {
    await asRawClient(ctx.db.unsafeRaw(UNDECLARED_REASON)).unsafe(
      `DELETE FROM test_leaky_undeclared`,
    );
  };

  const undeclaredFeature = defineFeature("test-leaky-undeclared", (r) => {
    r.useExtension(EXT_USER_DATA, "leaky-undeclared", {
      export: async () => null,
      delete: undeclaredLeakHook,
      // fw#2914 — deliberately NOT declared: this is the case under test.
    });
  });

  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [...baseFeatures(), undeclaredFeature] });
    await bootBaseTables(stack);
    await asRawClient(stack.db).unsafe(`
      CREATE TABLE IF NOT EXISTS test_leaky_undeclared (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL,
        secret TEXT NOT NULL
      )
    `);
    await asRawClient(stack.db).unsafe(
      `INSERT INTO test_leaky_undeclared (id, tenant_id, secret) VALUES
        ('22222222-2222-4222-8222-000000000001', $1, 'tenant-a-secret'),
        ('22222222-2222-4222-8222-000000000002', $2, 'tenant-b-secret')`,
      [TENANT_A, TENANT_B_FOREIGN],
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("undeclared unsafeRaw is denied and surfaces via result.errors, rows untouched", async () => {
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT_A);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
    });

    // The hook throws AccessDeniedError inside processUser's sub-tx — that
    // rolls the sub-tx back, so this user is NOT flipped to Deleted.
    expect(result.processedUserIds).not.toContain(FORGET_USER);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.entityName).toBe("leaky-undeclared");
    expect(result.errors[0]?.userId).toBe(FORGET_USER);
    expect(result.errors[0]?.message).toContain("escapeHatch");

    const remaining = await asRawClient(stack.db).unsafe(
      `SELECT tenant_id FROM test_leaky_undeclared ORDER BY tenant_id`,
    );
    // Both rows survive — the denial happened before any SQL executed, no
    // cross-tenant leak (pre-fix, this exact hook body would have wiped both).
    expect(remaining).toHaveLength(2);
  });
});
