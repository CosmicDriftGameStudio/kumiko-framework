// reindexEntity — Integration Test
// Proves: rows written before a search consumer ever indexed them (the
// #1206 scenario — searchable:true added retroactively) become findable
// after a backfill run, soft-deleted rows stay excluded, and dryRun writes
// nothing.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { reindexEntity } from "@cosmicdrift/kumiko-framework/search";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";

const widgetEntity = createEntity({
  table: "read_reindex_widgets",
  softDelete: true,
  fields: {
    name: createTextField({ required: true, searchable: true }),
  },
});

const widgetTable = buildEntityTable("widget", widgetEntity);

const widgetFeature = defineFeature("reindex-test", (r) => {
  r.entity("widget", widgetEntity);
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [widgetFeature] });
  await unsafeCreateEntityTable(stack.db, widgetEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

function seedExecutor() {
  return createEventStoreExecutor(widgetTable, widgetEntity, { entityName: "widget" });
}

function tenantDb() {
  return createTenantDb(stack.db, admin.tenantId, "system");
}

describe("reindexEntity", () => {
  test("indexes rows that were never drained through the search consumer", async () => {
    const executor = seedExecutor();
    const created = await executor.create({ name: "Backfillable Widget" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("seed failed");

    // No stack.eventDispatcher.runOnce() call — simulates rows that existed
    // before search indexing ever ran for this entity.
    const preResults = await stack.search.search(admin.tenantId, "backfillable", {
      filterType: "widget",
    });
    expect(preResults).toHaveLength(0);

    const result = await reindexEntity(
      stack.db,
      stack.registry,
      stack.search,
      "widget",
      admin.tenantId,
    );
    expect(result.indexedRows).toBe(1);
    expect(result.failures).toHaveLength(0);

    const postResults = await stack.search.search(admin.tenantId, "backfillable", {
      filterType: "widget",
    });
    expect(postResults.some((r) => r.entityId === created.data.id)).toBe(true);
  });

  test("skips soft-deleted rows", async () => {
    const executor = seedExecutor();
    const created = await executor.create({ name: "Erased Widget" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("seed failed");
    const deleted = await executor.delete({ id: created.data.id }, admin, tenantDb());
    if (!deleted.isSuccess) throw new Error("delete failed");

    await reindexEntity(stack.db, stack.registry, stack.search, "widget", admin.tenantId);

    const postResults = await stack.search.search(admin.tenantId, "erased", {
      filterType: "widget",
    });
    expect(postResults.some((r) => r.entityId === created.data.id)).toBe(false);
  });

  test("dryRun scans without writing to the index", async () => {
    const executor = seedExecutor();
    await executor.create({ name: "DryRun Widget" }, admin, tenantDb());

    const result = await reindexEntity(
      stack.db,
      stack.registry,
      stack.search,
      "widget",
      admin.tenantId,
      { dryRun: true },
    );
    expect(result.indexedRows).toBe(0);
    expect(result.wouldIndexRows).toBeGreaterThan(0);

    const postResults = await stack.search.search(admin.tenantId, "dryrun", {
      filterType: "widget",
    });
    expect(postResults).toHaveLength(0);
  });

  // kumiko-framework#1549: a searchable field with no matching read-table
  // column (dropped/never-migrated) used to push one identical failures[]
  // entry per scanned row instead of failing fast — fails loud on the first
  // row's column set instead, which is invariant across the whole scan.
  test("throws immediately when a searchable field has no matching column, without scanning every row", async () => {
    const executor = seedExecutor();
    await executor.create({ name: "Row A" }, admin, tenantDb());
    await executor.create({ name: "Row B" }, admin, tenantDb());

    await asRawClient(stack.db).unsafe(`ALTER TABLE "read_reindex_widgets" DROP COLUMN "name"`);
    try {
      await expect(
        reindexEntity(stack.db, stack.registry, stack.search, "widget", admin.tenantId),
      ).rejects.toThrow(/searchable field "name" is not mappable/);
    } finally {
      await asRawClient(stack.db).unsafe(
        `ALTER TABLE "read_reindex_widgets" ADD COLUMN "name" text`,
      );
    }
  });
});
