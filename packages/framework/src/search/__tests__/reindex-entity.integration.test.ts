// reindexEntity — Integration Test
// Proves: rows written before a search consumer ever indexed them (the
// #1206 scenario — searchable:true added retroactively) become findable
// after a backfill run, soft-deleted rows stay excluded, and dryRun writes
// nothing.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
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
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";

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

// fw#1611: pii + searchable — the read-table column holds ciphertext, a
// naive backfill would index blobs (or resurrect a crypto-shredded row).
const contactEntity = createEntity({
  table: "read_reindex_contacts",
  fields: {
    label: createTextField({ required: true, maxLength: 100, pii: true, searchable: true }),
  },
});
const contactTable = buildEntityTable("contact", contactEntity);
const contactFeature = defineFeature("reindex-pii-test", (r) => {
  r.entity("contact", contactEntity);
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [widgetFeature, contactFeature] });
  await unsafeCreateEntityTable(stack.db, widgetEntity);
  await unsafeCreateEntityTable(stack.db, contactEntity, "contact");
  await createEventsTable(stack.db);
  // Shared across both pii tests below (not per-test) — reindexEntity scans
  // the whole tenant table regardless of which test created which row, so a
  // fresh KMS instance per test would make earlier rows' subject keys
  // unresolvable (KeyNotFoundError) instead of exercising the erased path.
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
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

  // fw#1611: reindexEntity read the read-table row (ciphertext for pii+
  // searchable fields) straight into the search document, skipping the
  // decrypt step createSearchEventConsumer applies on the live path.
  test("decrypts pii+searchable fields before indexing — backfill is findable by plaintext, not ciphertext", async () => {
    const plain = "UniqueReindexPiiLabel1611";
    const executor = createEventStoreExecutor(contactTable, contactEntity, {
      entityName: "contact",
    });
    const created = await executor.create(
      { label: plain },
      admin,
      createTenantDb(stack.db, admin.tenantId, "system"),
    );
    if (!created.isSuccess) throw new Error("seed failed");

    // No dispatcher run — row exists only on the read-table, ciphertext.
    const row = (
      await asRawClient(stack.db).unsafe(
        `SELECT label FROM "read_reindex_contacts" WHERE id = $1`,
        [created.data.id],
      )
    )[0] as { label: string };
    expect(isPiiCiphertext(row.label)).toBe(true);

    const result = await reindexEntity(
      stack.db,
      stack.registry,
      stack.search,
      "contact",
      admin.tenantId,
    );
    expect(result.indexedRows).toBe(1);
    expect(result.failures).toHaveLength(0);

    const hits = await stack.search.search(admin.tenantId, plain, { filterType: "contact" });
    expect(hits.some((h) => String(h.entityId) === String(created.data.id))).toBe(true);
  });

  test("skips a row whose subject key was already erased — reindex must not resurrect a crypto-shredded row", async () => {
    const plain = "ErasedReindexPiiLabel1611";
    const executor = createEventStoreExecutor(contactTable, contactEntity, {
      entityName: "contact",
    });
    const created = await executor.create(
      { label: plain },
      admin,
      createTenantDb(stack.db, admin.tenantId, "system"),
    );
    if (!created.isSuccess) throw new Error("seed failed");

    // pii: true → subject key is the entity id itself.
    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });

    const result = await reindexEntity(
      stack.db,
      stack.registry,
      stack.search,
      "contact",
      admin.tenantId,
    );
    // Shares the tenant/table with the preceding test, so other rows may
    // also index here — what matters is that THIS erased row didn't.
    expect(result.failures).toHaveLength(0);

    const hits = await stack.search.search(admin.tenantId, plain, { filterType: "contact" });
    expect(hits.some((h) => String(h.entityId) === String(created.data.id))).toBe(false);
  });
});
