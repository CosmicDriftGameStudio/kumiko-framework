// Configurable tenant-occupancy model for GDPR forget (Art. 17).
//
// A tenant-scoped contributor (e.g. credit) has no per-user column to anonymize,
// so per-user erasure of tenant data is only safe when the tenant has exactly
// one user. The app declares that via the `tenantModel` config; the forget
// pipeline refines it per-tenant with a runtime sole-member check before handing
// `ctx.tenantModel` to each delete-hook.
//
// This drives the REAL config resolution (appOverride → resolveAppTenantModel)
// and the REAL forget pipeline (sole-member refinement → ctx.tenantModel →
// contributor delete) — NOT a hand-set ctx, which would prove the hook's `if`
// but not that the config string + system-scope resolution actually carry the
// value (the failure mode that shipped the ctx.config export bug).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  SYSTEM_USER_ID,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValueEntity } from "../../config/table";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity } from "../../user";
import { TENANT_MODEL_CONFIG_KEY } from "../constants";
import { createUserDataRightsFeature } from "../feature";
import { resolveAppTenantModel } from "../lib/resolve-tenant-model";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
} from "./forget-test-helpers";

const TENANT = "00000000-0000-4000-8000-0000000000c1";
const FORGET_USER = "cccccccc-cccc-4ccc-8ccc-0000000000c1";
const CO_MEMBER = "cccccccc-cccc-4ccc-8ccc-0000000000c2";
const TABLE = "read_dsgvo_tenant_scoped";

// Tenant-scoped contributor with NO per-user column — deletes by tenant only,
// and ONLY when this tenant is effectively single-user (mirrors credit).
const tenantScopedDeleteHook: UserDataDeleteHook = async (ctx) => {
  if (ctx.tenantModel !== "single-user") return; // shared tenant: erasing would hit co-members
  await asRawClient(ctx.db).unsafe(`DELETE FROM ${TABLE} WHERE tenant_id = $1`, [ctx.tenantId]);
};

const scopedEntity = createEntity({
  table: TABLE,
  fields: { name: createTextField({ required: true }) },
});

const contributorFeature = defineFeature("dsgvo-tenant-scoped", (r) => {
  r.entity("tenant-scoped", scopedEntity);
  r.useExtension(EXT_USER_DATA, "tenant-scoped", {
    export: async () => null,
    delete: tenantScopedDeleteHook,
  });
});

let stack: TestStack;
const seed = (db: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: dummy writer; this contributor has no binaries.
  createForgetSeeders(db as any, { write: async () => {} });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createConfigFeature(),
      createUserDataRightsFeature(),
      contributorFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, configValueEntity);
  await unsafeCreateEntityTable(stack.db, scopedEntity);
  await createEventsTable(stack.db);
  await asRawClient(stack.db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
  await asRawClient(stack.db).unsafe(`DELETE FROM ${TABLE}`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_memberships`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_users`);
});

async function seedScopedRow(rowId: string): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${TABLE} (id, tenant_id, name) VALUES ($1, $2, 'loan')`,
    [rowId, TENANT],
  );
}

async function rowCount(): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe(`SELECT id FROM ${TABLE} WHERE tenant_id = $1`, [
    TENANT,
  ]);
  return (rows as ReadonlyArray<unknown>).length;
}

describe("tenant-model config resolution (seam)", () => {
  test("appOverride single-user resolves through the real config resolver", async () => {
    const model = await resolveAppTenantModel({
      registry: stack.registry,
      configResolver: createConfigResolver({
        appOverrides: new Map([[TENANT_MODEL_CONFIG_KEY, "single-user"]]),
      }),
      db: stack.db,
      userId: SYSTEM_USER_ID,
    });
    expect(model).toBe("single-user");
  });

  test("no override falls back to the feature default (multi-user)", async () => {
    const model = await resolveAppTenantModel({
      registry: stack.registry,
      configResolver: createConfigResolver({ appOverrides: new Map() }),
      db: stack.db,
      userId: SYSTEM_USER_ID,
    });
    expect(model).toBe("multi-user");
  });
});

describe("forget pipeline honours the effective tenant model", () => {
  test("single-user + sole member → tenant-scoped rows erased", async () => {
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c1");
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
      tenantModel: "single-user",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);
    expect(await rowCount()).toBe(0);
  });

  test("single-user but a co-member exists → rows preserved (sole-member guard)", async () => {
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c2");
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT);
    await seed(stack.db).seedMembership(CO_MEMBER, TENANT);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
      tenantModel: "single-user",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);
    // A stray invite made the config's claim false at runtime — the co-member's
    // loan book must survive even though the user was forgotten.
    expect(await rowCount()).toBe(1);
  });

  test("multi-user → tenant-scoped rows preserved", async () => {
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c3");
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
      tenantModel: "multi-user",
    });

    expect(result.errors).toHaveLength(0);
    expect(await rowCount()).toBe(1);
  });
});
