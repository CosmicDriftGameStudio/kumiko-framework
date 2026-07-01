// DSGVO forget hook-ordering — the custom-fields anonymize strip must run
// before any host hook that nulls the owner column it filters on, regardless
// of feature registration order.
//
// Two host entities are wired with the OPPOSITE EXT_USER_DATA registration
// order: one registers the custom-fields strip first (the order that happened
// to be safe), the other registers the owner-nulling host hook first (the
// order that exposed the bug). Both run through the real `runForgetCleanup`
// with strategy=anonymize. With the order-sentinel fix both strip the
// sensitive jsonb key; without it the host-first entity would leave it behind
// (the strip matches 0 rows after the owner column is nulled).
//
// This drives the full runner on purpose: the existing custom-fields
// user-data-rights test invokes the strip hook in isolation
// (getExtensionUsages + direct call) and is structurally blind to ordering.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow as seedProjectionRow } from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { fieldDefinitionEntity } from "../../custom-fields/entity";
import { createCustomFieldsFeature } from "../../custom-fields/feature";
import { customFieldsField } from "../../custom-fields/wire-for-entity";
import { wireCustomFieldsUserDataRightsFor } from "../../custom-fields/wire-user-data-rights";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { tenantRetentionOverrideTable } from "../../data-retention/schema/tenant-retention-override";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
} from "./forget-test-helpers";

const TENANT = "00000000-0000-4000-8000-0000000000aa";

// Owner-nulling host anonymize hook (the canonical "anonymize keeps the row,
// clears the owner" pattern — same shape as file-ref/user host hooks).
function makeHostDeleteHook(tableName: string): UserDataDeleteHook {
  return async (ctx, strategy) => {
    if (strategy === "delete") {
      await asRawClient(ctx.db).unsafe(
        `DELETE FROM ${tableName} WHERE inserted_by_id = $1 AND tenant_id = $2`,
        [ctx.userId, ctx.tenantId],
      );
      return;
    }
    await asRawClient(ctx.db).unsafe(
      `UPDATE ${tableName} SET inserted_by_id = NULL WHERE inserted_by_id = $1 AND tenant_id = $2`,
      [ctx.userId, ctx.tenantId],
    );
  };
}

interface HostSpec {
  readonly entityName: string;
  readonly tableName: string;
  readonly featureName: string;
}

const CF_FIRST: HostSpec = {
  entityName: "cf-first-prop",
  tableName: "read_dsgvo_cf_first",
  featureName: "dsgvo-cf-first",
};
const HOST_FIRST: HostSpec = {
  entityName: "host-first-prop",
  tableName: "read_dsgvo_host_first",
  featureName: "dsgvo-host-first",
};

function makeEntity(tableName: string) {
  return createEntity({
    table: tableName,
    fields: {
      name: createTextField({ required: true }),
      customFields: customFieldsField(),
    },
  });
}

const cfFirstEntity = makeEntity(CF_FIRST.tableName);
const hostFirstEntity = makeEntity(HOST_FIRST.tableName);
const cfFirstTable = buildEntityTable(CF_FIRST.entityName, cfFirstEntity);
const hostFirstTable = buildEntityTable(HOST_FIRST.entityName, hostFirstEntity);

// Registration order is the whole point: cfFirst registers the strip BEFORE the
// owner-nulling host hook; hostFirst registers the host hook FIRST (the order
// that exposed the bug). The order-sentinel must make both correct.
const cfFirstFeature = defineFeature(CF_FIRST.featureName, (r) => {
  r.entity(CF_FIRST.entityName, cfFirstEntity);
  r.requires("custom-fields");
  wireCustomFieldsUserDataRightsFor(r, {
    entityName: CF_FIRST.entityName,
    entityTable: cfFirstTable,
    userIdColumn: "inserted_by_id",
  });
  r.useExtension(EXT_USER_DATA, CF_FIRST.entityName, {
    export: async () => null,
    delete: makeHostDeleteHook(CF_FIRST.tableName),
  });
});

const hostFirstFeature = defineFeature(HOST_FIRST.featureName, (r) => {
  r.entity(HOST_FIRST.entityName, hostFirstEntity);
  r.requires("custom-fields");
  r.useExtension(EXT_USER_DATA, HOST_FIRST.entityName, {
    export: async () => null,
    delete: makeHostDeleteHook(HOST_FIRST.tableName),
  });
  wireCustomFieldsUserDataRightsFor(r, {
    entityName: HOST_FIRST.entityName,
    entityTable: hostFirstTable,
    userIdColumn: "inserted_by_id",
  });
});

const admin = createTestUser({ id: 1, roles: ["TenantAdmin"], tenantId: TENANT });
const FORGET_USER = "cccccccc-cccc-4ccc-8ccc-0000000000a1";

let stack: TestStack;
// biome-ignore lint/suspicious/noExplicitAny: dummy file-writer; these seeders never write binaries.
const seed = (db: unknown) => createForgetSeeders(db as any, { write: async () => {} });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createCustomFieldsFeature(),
      createUserDataRightsFeature(),
      cfFirstFeature,
      hostFirstFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, fieldDefinitionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, cfFirstEntity);
  await unsafeCreateEntityTable(stack.db, hostFirstEntity);
  await createEventsTable(stack.db);
  await asRawClient(stack.db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
});

afterAll(async () => {
  await stack.cleanup();
});

async function defineSensitiveField(entityName: string, fieldKey: string, sensitive: boolean) {
  await stack.http.writeOk(
    "custom-fields:write:define-tenant-field",
    {
      entityName,
      fieldKey,
      serializedField: { type: "text", sensitive },
      required: false,
      searchable: false,
      displayOrder: 0,
    },
    admin,
  );
}

async function seedAnonymizeOverride(entityName: string) {
  await seedProjectionRow(stack.db, tenantRetentionOverrideTable, {
    entityName,
    config: JSON.stringify({ keepFor: "0d", strategy: "anonymize" }),
    reason: "test: force anonymize strategy",
    tenantId: TENANT,
  });
}

async function seedRow(spec: HostSpec, rowId: string) {
  // Inline jsonb literal — binding the JSON as a `$n::jsonb` param double-encodes
  // it into a jsonb *string* scalar (jsonb_typeof='string'), which the strip's
  // object-guard skips. A literal stores a real object, matching what the
  // set-custom-field projection writes in production.
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${spec.tableName} (id, tenant_id, name, inserted_by_id, custom_fields)
     VALUES ($1, $2, $3, $4, '{"ssn":"123-45-6789","safe":"keep-me"}'::jsonb)`,
    [rowId, TENANT, `Row for ${spec.entityName}`, FORGET_USER],
  );
}

async function readRow(
  spec: HostSpec,
  rowId: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = await asRawClient(stack.db).unsafe(
    `SELECT id, inserted_by_id, custom_fields FROM ${spec.tableName} WHERE id = $1`,
    [rowId],
  );
  return (rows as ReadonlyArray<Record<string, unknown>>)[0];
}

beforeEach(async () => {
  await resetEventStore(stack);
  await asRawClient(stack.db).unsafe(`DELETE FROM ${CF_FIRST.tableName}`);
  await asRawClient(stack.db).unsafe(`DELETE FROM ${HOST_FIRST.tableName}`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_custom_field_definitions`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_retention_overrides`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_memberships`);
});

describe("forget hook-ordering :: redaction runs before owner-nulling regardless of registration order", () => {
  test("both registration orders strip the sensitive jsonb key and null the owner column", async () => {
    // Field defs (sensitive ssn, non-sensitive safe) for both entities.
    for (const spec of [CF_FIRST, HOST_FIRST]) {
      await defineSensitiveField(spec.entityName, "ssn", true);
      await defineSensitiveField(spec.entityName, "safe", false);
      await seedAnonymizeOverride(spec.entityName);
    }
    // Project the field definitions. Assert the pass had no failures: a silent
    // projection failure would leave read_custom_field_definitions empty, make
    // loadSensitiveFieldKeys return [], and turn the strip into a no-op —
    // verifying the test exercises the strip for the right reason.
    const pass = await stack.eventDispatcher?.runOnce();
    expect(pass?.failed ?? 0).toBe(0);

    const cfRowId = "dddddddd-dddd-4ddd-8ddd-000000000001";
    const hostRowId = "dddddddd-dddd-4ddd-8ddd-000000000002";
    await seedRow(CF_FIRST, cfRowId);
    await seedRow(HOST_FIRST, hostRowId);

    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
    });

    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(FORGET_USER);

    for (const [spec, rowId] of [
      [CF_FIRST, cfRowId],
      [HOST_FIRST, hostRowId],
    ] as const) {
      const row = await readRow(spec, rowId);
      // Owner column nulled by the host anonymize hook.
      expect(row?.["inserted_by_id"]).toBeNull();
      const cf = row?.["custom_fields"] as Record<string, unknown>;
      // Sensitive key stripped (the strip ran while the owner column still
      // pointed to the user) — this is the assertion that fails for the
      // host-first entity without the order-sentinel fix.
      expect(cf).not.toHaveProperty("ssn");
      // Non-sensitive key preserved.
      expect(cf["safe"]).toBe("keep-me");
    }
  });
});
