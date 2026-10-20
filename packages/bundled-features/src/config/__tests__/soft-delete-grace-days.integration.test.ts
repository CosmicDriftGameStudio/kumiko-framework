// The soft-delete cleanup job reads the per-tenant grace period through the real config
// path (config:write:set + createConfigResolver), not a mocked resolver.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient, buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../feature.ts";
import { createConfigResolver } from "../resolver.ts";
import { configValuesTable } from "../table.ts";

const GRACE_DAYS_KEY = "soft-delete:config:grace-days";
const CLEANUP_JOB = "soft-delete:job:cleanup";

const thingEntity = createEntity({
  table: "sdgd_things",
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});
const thingTable = buildEntityTable("thing", thingEntity);

const feature = defineFeature("sdgd", (r) => {
  r.entity({ name: "thing", ...thingEntity });
  r.writeHandler(defineEntityCreateHandler("thing", thingEntity, { access: { roles: ["Admin"] } }));
  r.writeHandler(defineEntityDeleteHandler("thing", thingEntity, { access: { roles: ["Admin"] } }));
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), feature],
    extraContext: () => ({ configResolver: createConfigResolver() }),
    jobs: {
      consumerLane: "worker",
      getActiveTenantIds: async () => [TestUsers.admin.tenantId, TestUsers.otherTenant.tenantId],
    },
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, thingEntity, "thing");
});

afterAll(async () => {
  await stack.cleanup();
});

async function createDeletedThing(user: typeof TestUsers.admin, ageDays: number): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "sdgd:write:thing:create",
    { label: "x" },
    user,
  );
  await stack.http.writeOk("sdgd:write:thing:delete", { id: created.id }, user);
  // kumiko-lint-ignore raw-sql test fixture sets deletedAt deterministically
  await asRawClient(stack.db).unsafe(
    "UPDATE sdgd_things SET deleted_at = now() - make_interval(days => $2) WHERE id = $1",
    [created.id, ageDays],
  );
  return created.id;
}

describe("soft-delete cleanup honours the per-tenant grace days", () => {
  test("a tenant override shorter than the default purges its 10-day-old row; a tenant without override keeps its row", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: GRACE_DAYS_KEY, value: 7 },
      TestUsers.systemAdmin,
    );
    const ownId = await createDeletedThing(TestUsers.admin, 10);
    const otherId = await createDeletedThing(TestUsers.otherTenant, 10);
    const jobRunner = stack.jobRunner;
    if (!jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");

    await jobRunner.dispatch(CLEANUP_JOB, {});

    await waitFor(async () => {
      expect(await selectMany(stack.db, thingTable, { id: ownId })).toHaveLength(0);
    });
    expect(await selectMany(stack.db, thingTable, { id: otherId })).toHaveLength(1);
  });
});
