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
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  entityEventName,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type JobContext,
  SYSTEM_USER_ID,
  type TenantId,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { bridgeStub } from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { buildEnvConfigOverrides, createConfigResolver } from "../../config/resolver";
import { configValueEntity } from "../../config/table";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant";
import { seedTenantMembership } from "../../tenant/seeding";
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
  fields: { name: createTextField({ required: true, personal: false, reason: "technical_reference" }) },
});

const contributorFeature = defineFeature("dsgvo-tenant-scoped", (r) => {
  r.entity("tenant-scoped", scopedEntity);
  r.useExtension(EXT_USER_DATA, "tenant-scoped", {
    export: async () => null,
    delete: tenantScopedDeleteHook,
  });
});

const membershipExecutor = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  {
    entityName: "tenant-membership",
  },
);

let stack: TestStack;
const seed = (db: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: dummy writer; this contributor has no binaries.
  createForgetSeeders(db as any, { write: async () => {} });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      authFoundationFeature,
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

  test("TENANT_MODEL env var bridges through the real registry to resolveAppTenantModel", async () => {
    // Mirrors the cascade.integration.test.ts env seam test, but pins it at
    // the real tenantModel key: registry → buildEnvConfigOverrides →
    // resolveAppTenantModel, so a key-qualification mismatch between the
    // feature's `env` declaration and the bridge would fail here, not just
    // on a stub registry.
    const keyDef = stack.registry.getConfigKey(TENANT_MODEL_CONFIG_KEY);
    expect(keyDef).toBeDefined();
    expect(keyDef?.env).toBe("TENANT_MODEL");

    const overrides = buildEnvConfigOverrides(stack.registry, { TENANT_MODEL: "single-user" });
    expect(overrides.get(TENANT_MODEL_CONFIG_KEY)).toBe("single-user");

    const model = await resolveAppTenantModel({
      registry: stack.registry,
      configResolver: createConfigResolver({ appOverrides: overrides }),
      db: stack.db,
      userId: SYSTEM_USER_ID,
    });
    expect(model).toBe("single-user");
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

  test("single-user, sole live member, but a departed co-member's history remains → rows preserved (ent#346)", async () => {
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c5");
    await seed(stack.db).seedForgetUser(FORGET_USER);
    // Both memberships go through the REAL event-store executor (not the
    // raw-INSERT seedMembership() helper) — the historical check reads
    // `tenant-membership.created` events, so FORGET_USER needs its own
    // `.created` event too, or the tenant would only ever show 1 distinct
    // historical member (CO_MEMBER) even after it truly had 2.
    // seedTenantMembership defaults `by` to createSystemUser(tenantId), so
    // the stream tenant matches TENANT (unlike seedTenant, which defaults
    // to TestUsers.systemAdmin).
    await seedTenantMembership(stack.db, {
      userId: FORGET_USER,
      tenantId: TENANT,
      roles: ["Member"],
    });

    // CO_MEMBER joins for real (emits tenant-membership.created) and is then
    // removed for real (emits tenant-membership.deleted, deletes the
    // projection row) — mirrors removeMemberWrite exactly, so the created
    // event survives in kumiko_events even though the live row is gone.
    const created = await seedTenantMembership(stack.db, {
      userId: CO_MEMBER,
      tenantId: TENANT,
      roles: ["Member"],
    });
    const deleteResult = await membershipExecutor.delete(
      { id: created.id },
      createSystemUser(TENANT),
      createTenantDb(stack.db, TENANT, "system"),
    );
    if (!deleteResult.isSuccess) {
      throw new Error(`test setup: co-member delete failed: ${deleteResult.error.code}`);
    }

    // Pins the test's premise: exactly 1 live membership row, so a live-count-
    // only check would call this tenant single-user (and the fix must reject
    // that call via history instead).
    const liveMemberships = await asRawClient(stack.db).unsafe(
      "SELECT id FROM read_tenant_memberships WHERE tenant_id = $1",
      [TENANT],
    );
    expect(liveMemberships.length).toBe(1);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
      tenantModel: "single-user",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);
    // Only 1 live membership remains (FORGET_USER) — the OLD live-only check
    // would have called this single-user and wiped the co-member's row. The
    // historical check must still resolve multi-user here.
    expect(await rowCount()).toBe(1);
  });

  test("single-user history latch uses payload tenantId (cross-tenant SystemAdmin actor)", async () => {
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c6");
    await seed(stack.db).seedForgetUser(FORGET_USER);
    const OTHER_TENANT = "dddddddd-dddd-4ddd-8ddd-0000000000aa" as TenantId;

    // Membership events billed to a foreign actor tenant — mirrors real
    // SystemAdmin addMember (event.tenant_id ≠ payload.tenantId).
    await seedTenantMembership(stack.db, {
      userId: FORGET_USER,
      tenantId: TENANT,
      roles: ["Member"],
      by: createSystemUser(OTHER_TENANT),
    });
    const created = await seedTenantMembership(stack.db, {
      userId: CO_MEMBER,
      tenantId: TENANT,
      roles: ["Member"],
      by: createSystemUser(OTHER_TENANT),
    });
    const deleteResult = await membershipExecutor.delete(
      { id: created.id },
      createSystemUser(OTHER_TENANT),
      createTenantDb(stack.db, TENANT, "system"),
    );
    if (!deleteResult.isSuccess) {
      throw new Error(`test setup: co-member delete failed: ${deleteResult.error.code}`);
    }

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
      tenantModel: "single-user",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);
    // Payload-tenant latch must still see 2 historical members.
    expect(await rowCount()).toBe(1);
  });

  test("single-user, sole member removed and re-added → rows still erased (#2608)", async () => {
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c7");
    await seed(stack.db).seedForgetUser(FORGET_USER);

    // Remove + re-add of the SAME person: removeMemberWrite only drops the
    // projection row, so two `tenant-membership.created` events survive for a
    // tenant that never had a co-member. Counting rows instead of identities
    // latched such a tenant to multi-user forever, and every tenantScopedOnly
    // erase hook skipped on the "co-members keep shared data" grounds.
    const first = await seedTenantMembership(stack.db, {
      userId: FORGET_USER,
      tenantId: TENANT,
      roles: ["Member"],
    });
    const deleteResult = await membershipExecutor.delete(
      { id: first.id },
      createSystemUser(TENANT),
      createTenantDb(stack.db, TENANT, "system"),
    );
    if (!deleteResult.isSuccess) {
      throw new Error(`test setup: member removal failed: ${deleteResult.error.code}`);
    }
    await seedTenantMembership(stack.db, {
      userId: FORGET_USER,
      tenantId: TENANT,
      roles: ["Member"],
    });

    // Pins the premise: 2 created-events, 1 distinct userId, 1 live member.
    const createdEvents = await asRawClient(stack.db).unsafe(
      `SELECT payload->>'userId' AS user_id FROM kumiko_events
        WHERE aggregate_type = 'tenant-membership' AND type = $1 AND payload->>'tenantId' = $2`,
      [entityEventName("tenant-membership", "created"), TENANT],
    );
    expect(createdEvents.length).toBe(2);
    const liveMemberships = await asRawClient(stack.db).unsafe(
      "SELECT id FROM read_tenant_memberships WHERE tenant_id = $1",
      [TENANT],
    );
    expect(liveMemberships.length).toBe(1);

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

  test("single-user, sole member, but a created-event with unreadable userId → rows preserved", async () => {
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c8");
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seedTenantMembership(stack.db, {
      userId: FORGET_USER,
      tenantId: TENANT,
      roles: ["Member"],
    });

    // A created-event whose userId payload cannot be read may name a second
    // member — the fail-safe branch must survive the #2608 fix.
    await asRawClient(stack.db).unsafe(
      `INSERT INTO kumiko_events
         (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
       VALUES ($1, 'tenant-membership', $2, 1, $3, $4, '{}'::jsonb, 'system')`,
      [
        "eeeeeeee-eeee-4eee-8eee-0000000000c8",
        TENANT,
        entityEventName("tenant-membership", "created"),
        // Object, not JSON.stringify: a string param into a jsonb column is
        // encoded a second time and lands as a JSON scalar, which no
        // payload->>'...' lookup would ever match.
        { tenantId: TENANT },
      ],
    );

    const createdEvents = await asRawClient(stack.db).unsafe(
      `SELECT payload->>'userId' AS user_id FROM kumiko_events
        WHERE aggregate_type = 'tenant-membership' AND type = $1 AND payload->>'tenantId' = $2`,
      [entityEventName("tenant-membership", "created"), TENANT],
    );
    expect(createdEvents.length).toBe(2);

    // Without exactly one live member the live gate would answer multi-user
    // before the history latch runs, and this test would prove nothing.
    const liveMemberships = await asRawClient(stack.db).unsafe(
      "SELECT id FROM read_tenant_memberships WHERE tenant_id = $1",
      [TENANT],
    );
    expect(liveMemberships.length).toBe(1);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
      tenantModel: "single-user",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);
    expect(await rowCount()).toBe(1);
  });
});

describe("run-forget-cleanup job — real glue-code, not a hand-set tenantModel", () => {
  test("the registered job resolves tenantModel via resolveAppTenantModel and actually erases", async () => {
    // Every test above passes tenantModel as a literal string straight into
    // runForgetCleanup — none exercise the job's OWN glue (feature.ts:
    // resolveAppTenantModel(...) → runForgetCleanup({..., tenantModel})). A
    // key-mismatch, forgotten argument, or wrong db-handle at either call site
    // would pass every test above and still be broken in production.
    await seedScopedRow("dddddddd-dddd-4ddd-8ddd-0000000000c4");
    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT);

    const job = stack.registry.getJob("user-data-rights:job:run-forget-cleanup");
    expect(job).toBeDefined();
    if (!job) return;

    const ctx: JobContext = {
      db: stack.db,
      registry: stack.registry,
      configResolver: createConfigResolver({
        appOverrides: new Map([[TENANT_MODEL_CONFIG_KEY, "single-user"]]),
      }),
      systemUser: { id: SYSTEM_USER_ID, tenantId: TENANT, roles: ["all"] },
      log: {
        info() {},
        warn() {},
        error() {},
        debug() {},
        child(): JobContext["log"] {
          return this;
        },
      },
      triggeredBy: null,
      ...bridgeStub(),
    };
    await job.handler({}, ctx);

    expect(await rowCount()).toBe(0);
  });
});
