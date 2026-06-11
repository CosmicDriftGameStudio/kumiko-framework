// T1.5c — user-data-rights wiring for custom-fields, exercised through the
// REAL export/forget runners (runUserExport / runForgetCleanup), not by
// calling the registered hooks in isolation.
//
// What the real runners prove that direct hook calls cannot:
//
//   * runUserExport actually picks up the custom-fields export hook from the
//     registry and folds its snippet into the user's cross-tenant bundle.
//
//   * runForgetCleanup fires BOTH the host EXT_USER_DATA hook (owner-nulling
//     anonymize) AND the custom-fields strip hook, in the order their declared
//     `order` demands. The strip declares order -100 so it redacts sensitive
//     jsonb keyed on `inserted_by_id` BEFORE the host hook nulls that column.
//     If the ordering regressed, the host hook would null inserted_by_id first,
//     the strip's `WHERE inserted_by_id = userId` would match 0 rows, and
//     sensitive PII would silently survive (Art. 17 violation). Calling the
//     hooks by hand never exercised this interaction.
//
//   * The anonymize-vs-delete strategy comes from the data-retention policy:
//     no override → strategy "delete" (custom-fields strip is a no-op, host
//     deletes the row); per-tenant anonymize override → strategy "anonymize"
//     (strip runs, host nulls the owner).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { tenantRetentionOverrideTable } from "../../data-retention/schema/tenant-retention-override";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsFeature } from "../../user-data-rights";
import { runForgetCleanup } from "../../user-data-rights/run-forget-cleanup";
import { runUserExport } from "../../user-data-rights/run-user-export";
import { fieldDefinitionEntity } from "../entity";
import { createCustomFieldsFeature } from "../feature";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";
import { wireCustomFieldsUserDataRightsFor } from "../wire-user-data-rights";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const NOW = (): Instant => getTemporal().Now.instant();
const PAST = (): Instant => getTemporal().Now.instant().subtract({ minutes: 1 });

const propertyEntity = createEntity({
  table: "read_t15c_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});
const propertyTable = buildEntityTable("property", propertyEntity);

// Host entity gets its own EXT_USER_DATA-registration too — that's the
// canonical setup. The host's anonymize hook NULLS inserted_by_id (default
// order 0); the custom-fields strip (order -100) must run first. Both fire in
// the same runForgetCleanup sub-transaction.
const hostExportHook: UserDataExportHook = async (ctx) => {
  const rows = await asRawClient(ctx.db).unsafe(
    `SELECT id, name FROM read_t15c_properties WHERE inserted_by_id = $1 AND tenant_id = $2`,
    [ctx.userId, ctx.tenantId],
  );
  const list = rows as ReadonlyArray<Record<string, unknown>>;
  if (list.length === 0) return null;
  return {
    entity: "property",
    rows: list.map((r) => ({ id: r["id"] as string, name: r["name"] as string })),
  };
};

const hostDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  if (strategy === "delete") {
    await asRawClient(ctx.db).unsafe(
      `DELETE FROM read_t15c_properties WHERE inserted_by_id = $1 AND tenant_id = $2`,
      [ctx.userId, ctx.tenantId],
    );
  } else {
    // anonymize: clear owner, keep row + non-sensitive customFields. Runs AFTER
    // the custom-fields strip (order -100 < 0) — if it ran first, the strip's
    // owner-keyed WHERE would match nothing.
    await asRawClient(ctx.db).unsafe(
      `UPDATE read_t15c_properties SET inserted_by_id = NULL WHERE inserted_by_id = $1 AND tenant_id = $2`,
      [ctx.userId, ctx.tenantId],
    );
  }
};

const propertyFeature = defineFeature("property-t15c", (r) => {
  r.entity("property", propertyEntity);
  r.requires("custom-fields");
  wireCustomFieldsFor(r, "property", propertyTable);
  wireCustomFieldsUserDataRightsFor(r, {
    entityName: "property",
    entityTable: propertyTable,
    userIdColumn: "inserted_by_id",
  });
  r.useExtension(EXT_USER_DATA, "property", {
    export: hostExportHook,
    delete: hostDeleteHook,
  });

  const { executor } = createEntityExecutor("property", propertyEntity);
  r.writeHandler({
    name: "property:create",
    schema: z.object({ id: z.string(), name: z.string() }),
    access: { roles: ["TenantAdmin", "TenantMember"] },
    handler: async (event, ctx) =>
      executor.create(
        { id: event.payload.id, name: event.payload.name, customFields: {} },
        event.user,
        ctx.db,
      ),
  });
});

const customFieldsFeature = createCustomFieldsFeature();
const admin = createTestUser({ id: 1, roles: ["TenantAdmin"] });
const TENANT = admin.tenantId;

let stack: TestStack;
let overrideExecutor: ReturnType<typeof createEventStoreExecutor>;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      customFieldsFeature,
      createUserDataRightsFeature(),
      propertyFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, propertyEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await createEventsTable(stack.db);

  // runForgetCleanup + runUserExport iterate the user's memberships. Provide a
  // minimal membership read-model (same shape the user-data-rights suite uses).
  await asRawClient(stack.db).unsafe(`
    CREATE TABLE IF NOT EXISTS read_tenant_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      inserted_by_id TEXT,
      modified_by_id TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      deleted_at TIMESTAMPTZ,
      deleted_by_id TEXT,
      roles TEXT NOT NULL DEFAULT '[]',
      UNIQUE(user_id, tenant_id)
    )
  `);

  overrideExecutor = createEventStoreExecutor(
    tenantRetentionOverrideTable,
    tenantRetentionOverrideEntity,
    { entityName: "tenant-retention-override" },
  );
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_t15c_properties`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_memberships`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantRetentionOverrideTable.tableName}"`);
});

async function defineField(fieldKey: string, serializedField: Record<string, unknown>) {
  return stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName: "property",
      fieldKey,
      serializedField,
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

async function createProperty(id: string, name: string) {
  return stack.http.writeOk("property-t15c:write:property:create", { id, name }, admin);
}

async function setField(entityId: string, fieldKey: string, value: unknown) {
  return stack.http.writeOk(
    "custom-fields:write:set-custom-field",
    { entityName: "property", entityId, fieldKey, value },
    admin,
  );
}

async function readRow(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await asRawClient(stack.db).unsafe(
    `SELECT id, custom_fields, inserted_by_id FROM read_t15c_properties WHERE id = $1`,
    [id],
  );
  const list = rows as ReadonlyArray<Record<string, unknown>>;
  return list[0];
}

// Seed the acting admin as a normal active user with a membership in TENANT so
// the export runner iterates their data. Status active = NOT picked up by
// runForgetCleanup.
async function seedActiveUserWithMembership(): Promise<void> {
  await insertOne(stack.db, userTable, {
    id: admin.id,
    tenantId: TENANT,
    email: `admin@example.com`,
    passwordHash: "hashed",
    displayName: "Admin",
    locale: "de",
    emailVerified: true,
    roles: '["TenantAdmin"]',
    status: USER_STATUS.Active,
  });
  await seedMembership();
}

// Seed the acting admin as DeletionRequested + grace expired so
// runForgetCleanup picks them up, with a membership in TENANT.
async function seedForgetUserWithMembership(): Promise<void> {
  await insertOne(stack.db, userTable, {
    id: admin.id,
    tenantId: TENANT,
    email: `admin@example.com`,
    passwordHash: "hashed",
    displayName: "Admin",
    locale: "de",
    emailVerified: true,
    roles: '["TenantAdmin"]',
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd: PAST(),
  });
  await seedMembership();
}

async function seedMembership(): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
     VALUES ($1, $2, '["TenantAdmin"]') ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [TENANT, admin.id],
  );
}

// Set a per-tenant retention override for the property entity through the same
// event-store path the forget resolver reads — no test-only shortcut.
async function seedPropertyAnonymizeOverride(): Promise<void> {
  const by = { ...TestUsers.systemAdmin, tenantId: TENANT };
  const result = await overrideExecutor.create(
    {
      entityName: "property",
      config: JSON.stringify({ keepFor: "30d", strategy: "anonymize" }),
      reason: "test",
      tenantId: TENANT,
    },
    by,
    createTenantDb(stack.db, TENANT, "system"),
  );
  if (!result.isSuccess)
    throw new Error(`seedPropertyAnonymizeOverride failed: ${JSON.stringify(result)}`);
}

describe("T1.5c: custom-fields user-data-rights through the real runners", () => {
  test("export: customFields jsonb lands in the user's export bundle", async () => {
    await seedActiveUserWithMembership();
    const propertyId = "11111111-1111-4000-8000-000000000001";
    await defineField("email", { type: "text", sensitive: true });
    await defineField("vipFlag", { type: "boolean" });
    await createProperty(propertyId, "Hofgarten 12");
    await setField(propertyId, "email", "alice@example.com");
    await setField(propertyId, "vipFlag", true);
    await stack.eventDispatcher?.runOnce();

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: admin.id,
      now: NOW(),
    });

    const tenantSection = bundle.tenants.find((t) => t.tenantId === TENANT);
    expect(tenantSection).toBeDefined();
    const cfSnippet = tenantSection?.entities.find((e) => e.entity === "property.customFields");
    expect(cfSnippet).toBeDefined();
    expect(cfSnippet?.rows).toHaveLength(1);
    expect(cfSnippet?.rows[0]?.["customFields"]).toMatchObject({
      email: "alice@example.com",
      vipFlag: true,
    });
  });

  test("forget anonymize: strip runs BEFORE host owner-nulling → sensitive key gone, non-sensitive kept", async () => {
    await seedForgetUserWithMembership();
    await seedPropertyAnonymizeOverride();
    const propertyId = "22222222-2222-4000-8000-000000000002";
    await defineField("email", { type: "text", sensitive: true });
    await defineField("vipFlag", { type: "boolean" });
    await createProperty(propertyId, "Anonymize-Me");
    await setField(propertyId, "email", "alice@example.com");
    await setField(propertyId, "vipFlag", true);
    await stack.eventDispatcher?.runOnce();

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(admin.id);
    expect(result.errors).toHaveLength(0);

    const row = await readRow(propertyId);
    // Host hook ran (owner nulled), and the strip ran BEFORE it (sensitive
    // key removed despite the owner-keyed WHERE — proof of the -100 ordering).
    expect(row?.["inserted_by_id"]).toBeNull();
    const customFields = row?.["custom_fields"] as Record<string, unknown> | undefined;
    expect(customFields).toBeDefined();
    expect(customFields).not.toHaveProperty("email");
    expect(customFields).toMatchObject({ vipFlag: true });
  });

  test("forget delete (no override → strategy delete): host removes the row, strip is a no-op", async () => {
    await seedForgetUserWithMembership();
    // No retention override → policyToStrategy(null) = "delete".
    const propertyId = "33333333-3333-4000-8000-000000000003";
    await defineField("email", { type: "text", sensitive: true });
    await createProperty(propertyId, "Delete-Me");
    await setField(propertyId, "email", "alice@example.com");
    await stack.eventDispatcher?.runOnce();

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(admin.id);

    // Host delete-hook removed the row; custom-fields strip stayed out of the
    // way (it returns early on strategy=delete).
    expect(await readRow(propertyId)).toBeUndefined();
  });

  test("export: rows without customFields are not included in the snippet", async () => {
    await seedActiveUserWithMembership();
    const propertyId = "44444444-4444-4000-8000-000000000004";
    await createProperty(propertyId, "NoCustomFields");
    await stack.eventDispatcher?.runOnce();

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: admin.id,
      now: NOW(),
    });

    const tenantSection = bundle.tenants.find((t) => t.tenantId === TENANT);
    const cfSnippet = tenantSection?.entities.find((e) => e.entity === "property.customFields");
    expect(cfSnippet).toBeUndefined();
  });

  test("forget anonymize without sensitive fields defined → all customFields kept", async () => {
    await seedForgetUserWithMembership();
    await seedPropertyAnonymizeOverride();
    const propertyId = "55555555-5555-4000-8000-000000000005";
    await defineField("nonSensitive", { type: "text" });
    await createProperty(propertyId, "AllStay");
    await setField(propertyId, "nonSensitive", "still-here");
    await stack.eventDispatcher?.runOnce();

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: NOW(),
    });
    expect(result.processedUserIds).toContain(admin.id);

    const row = await readRow(propertyId);
    expect(row?.["inserted_by_id"]).toBeNull();
    expect((row?.["custom_fields"] as Record<string, unknown>)?.["nonSensitive"]).toBe(
      "still-here",
    );
  });
});
