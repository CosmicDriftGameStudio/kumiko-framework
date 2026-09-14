// fw#2914 — soft-delete cleanup runs through the real job runner with ctx.db as a
// tenant-filtered TenantDb: a run purges only its own tenant's expired rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "../../bun-db/query";
import { selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { waitFor } from "../../testing";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineFeature,
} from "../index";
import { SOFT_DELETE_CLEANUP_JOB } from "../soft-delete-cleanup";

const itemEntity = createEntity({
  table: "fw2914_sdc_items",
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});
const itemTable = buildEntityTable("item", itemEntity);

const feature = defineFeature("sdcjob", (r) => {
  r.entity("item", itemEntity);
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
});

afterAll(async () => {
  await stack.cleanup();
});

async function createExpiredDeletedItem(user: typeof TestUsers.admin): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "sdcjob:write:item:create",
    { label: `expired-${user.tenantId}` },
    user,
  );
  await stack.http.writeOk("sdcjob:write:item:delete", { id: created.id }, user);
  // kumiko-lint-ignore raw-sql test fixture ages deletedAt past the default grace period
  await asRawClient(stack.db).unsafe(
    `UPDATE fw2914_sdc_items SET deleted_at = now() - interval '400 days' WHERE id = $1`,
    [created.id],
  );
  return created.id;
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
