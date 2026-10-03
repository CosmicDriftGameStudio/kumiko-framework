// fw#2914 — soft-delete cleanup runs through the real job runner with ctx.db as a
// tenant-filtered TenantDb: a run purges only its own tenant's expired rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "../../bun-db/query.js";
import { selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineFeature,
} from "../index.js";
import { SOFT_DELETE_CLEANUP_JOB, SOFT_DELETE_CLEANUP_SYSTEM_JOB } from "../soft-delete-cleanup.js";

const itemEntity = createEntity({
  table: "fw2914_sdc_items",
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});
const itemTable = buildEntityTable("item", itemEntity);

// Mirrors the bundled `user` entity: global tenancy, yet the table still carries a tenant_id column.
const globalItemEntity = createEntity({
  table: "fw3529_sdc_global_items",
  tenancy: "global",
  systemStream: true,
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  access: { write: { Admin: "all" } },
});
const globalItemTable = buildEntityTable("globalItem", globalItemEntity);

const feature = defineFeature("sdcjob", (r) => {
  r.entity("item", itemEntity);
  r.entity("globalItem", globalItemEntity);
  r.writeHandler(
    defineEntityCreateHandler("globalItem", globalItemEntity, { access: { roles: ["Admin"] } }),
  );
  r.writeHandler(
    defineEntityDeleteHandler("globalItem", globalItemEntity, { access: { roles: ["Admin"] } }),
  );
  r.writeHandler(defineEntityCreateHandler("item", itemEntity, { access: { roles: ["Admin"] } }));
  r.writeHandler(defineEntityDeleteHandler("item", itemEntity, { access: { roles: ["Admin"] } }));
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [feature],
    jobs: {
      consumerLane: "worker",
      getActiveTenantIds: async () => [TestUsers.admin.tenantId],
    },
  });
  await unsafeCreateEntityTable(stack.db, itemEntity, "item");
  await unsafeCreateEntityTable(stack.db, globalItemEntity, "globalItem");
});

afterAll(async () => {
  await stack.cleanup();
});

async function ageDeletedAt(tableName: string, id: string, days: number): Promise<void> {
  // kumiko-lint-ignore raw-sql test fixture ages deletedAt past the default grace period
  await asRawClient(stack.db).unsafe(
    `UPDATE ${tableName} SET deleted_at = now() - make_interval(days => $2) WHERE id = $1`,
    [id, days],
  );
}

async function createSoftDeleted(
  entityName: "item" | "global-item",
  tableName: string,
  user: typeof TestUsers.admin,
  ageDays: number,
): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    `sdcjob:write:${entityName}:create`,
    { label: `row-${user.tenantId}` },
    user,
  );
  await stack.http.writeOk(`sdcjob:write:${entityName}:delete`, { id: created.id }, user);
  await ageDeletedAt(tableName, created.id, ageDays);
  return created.id;
}

function createExpiredDeletedItem(user: typeof TestUsers.admin): Promise<string> {
  return createSoftDeleted("item", "fw2914_sdc_items", user, 400);
}

describe("soft-delete cleanup job smoke run on a tenant-filtered JobContext.db (fw#2914)", () => {
  test("a per-tenant fan-out run purges only the active tenant's expired soft-deleted rows", async () => {
    const ownId = await createExpiredDeletedItem(TestUsers.admin);
    const foreignId = await createExpiredDeletedItem(TestUsers.otherTenant);
    const jobRunner = stack.jobRunner;
    if (!jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");

    await jobRunner.dispatch(SOFT_DELETE_CLEANUP_JOB, {});

    await waitFor(async () => {
      const own = await selectMany(stack.db, itemTable, { id: ownId });
      expect(own).toHaveLength(0);
    });
    const foreign = await selectMany(stack.db, itemTable, { id: foreignId });
    expect(foreign).toHaveLength(1);
    expect(foreign[0]?.["isDeleted"]).toBe(true);
  });
});

describe("soft-delete cleanup with a tenancy: global entity (fw#3529)", () => {
  test("per-tenant run survives the global table; the system run purges only the expired global row", async () => {
    const jobRunner = stack.jobRunner;
    if (!jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
    const tenantItemId = await createExpiredDeletedItem(TestUsers.admin);
    const expiredGlobalId = await createSoftDeleted(
      "global-item",
      "fw3529_sdc_global_items",
      TestUsers.admin,
      400,
    );
    const freshGlobalId = await createSoftDeleted(
      "global-item",
      "fw3529_sdc_global_items",
      TestUsers.admin,
      1,
    );

    await jobRunner.dispatch(SOFT_DELETE_CLEANUP_JOB, {});
    await waitFor(async () => {
      expect(await selectMany(stack.db, itemTable, { id: tenantItemId })).toHaveLength(0);
    });
    expect(await selectMany(stack.db, globalItemTable, { id: expiredGlobalId })).toHaveLength(1);

    await jobRunner.dispatch(SOFT_DELETE_CLEANUP_SYSTEM_JOB, {});
    await waitFor(async () => {
      expect(await selectMany(stack.db, globalItemTable, { id: expiredGlobalId })).toHaveLength(0);
    });
    expect(await selectMany(stack.db, globalItemTable, { id: freshGlobalId })).toHaveLength(1);
  });
});
