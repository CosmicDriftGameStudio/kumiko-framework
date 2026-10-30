// reindexEntity — Integration Test
// Proves: rows written before a search consumer ever indexed them (the
// searchable:true added retroactively) become findable
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
import { reindexEntity, type SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { TestUsers } from "../../seeding/seed-users.ts";

const widgetEntity = createEntity({
  table: "read_reindex_widgets",
  softDelete: true,
  fields: {
    name: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
  },
});

const widgetTable = buildEntityTable("widget", widgetEntity);

// Own table for the drop-column test: Bun.SQL caches prepared statements per
// pooled connection, and a connection that already ran reindexEntity's
// `SELECT *` on a table fails with "cached plan must not change result type"
// after that table loses a column. A table no earlier test has scanned keeps
// the outcome independent of which pooled connection the scan lands on.
const gadgetEntity = createEntity({
  table: "read_reindex_gadgets",
  fields: {
    name: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
  },
});

const gadgetTable = buildEntityTable("gadget", gadgetEntity);

const widgetFeature = defineFeature("reindex-test", (r) => {
  r.entity({ name: "widget", ...widgetEntity });
  r.entity({ name: "gadget", ...gadgetEntity });
});

// pii + searchable — the read-table column holds ciphertext, a
// naive backfill would index blobs (or resurrect a crypto-shredded row).
const contactEntity = createEntity({
  table: "read_reindex_contacts",
  fields: {
    label: createTextField({ required: true, maxLength: 100, personal: "self", find: "fuzzy" }),
  },
});
const contactTable = buildEntityTable("contact", contactEntity);
const contactFeature = defineFeature("reindex-pii-test", (r) => {
  r.entity({ name: "contact", ...contactEntity });
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [widgetFeature, contactFeature] });
  await unsafeCreateEntityTable(stack.db, widgetEntity);
  await unsafeCreateEntityTable(stack.db, gadgetEntity, "gadget");
  await unsafeCreateEntityTable(stack.db, contactEntity, "contact");
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
  return createTenantDb({
    db: stack.db,
    tenantId: admin.tenantId,
    mode: "system",
    reason: "test reindex reads entity rows across tenants",
  });
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

  test("rows deleted while the scan runs do not make it skip later rows", async () => {
    const executor = seedExecutor();
    for (let n = 1; n <= 5; n++) {
      const created = await executor.create({ name: `Keyset Widget ${n}` }, admin, tenantDb());
      if (!created.isSuccess) throw new Error("seed failed");
    }
    const client = asRawClient(stack.db);
    const [{ count } = { count: "0" }] = await client.unsafe<{ count: string }>(
      `SELECT count(*)::text AS count FROM "read_reindex_widgets" WHERE "tenant_id" = $1 AND "is_deleted" IS NOT TRUE`,
      [admin.tenantId],
    );
    const rowsBeforeScan = Number(count);
    expect(rowsBeforeScan).toBeGreaterThanOrEqual(5);

    // Removing each batch's rows right after it was read shifts an OFFSET window past the next rows.
    const deletingAdapter = Object.assign(Object.create(stack.search), {
      indexBatch: async (_tenantId: string, docs: readonly { entityId: string }[]) => {
        for (const doc of docs) {
          await client.unsafe(`DELETE FROM "read_reindex_widgets" WHERE "id" = $1`, [doc.entityId]);
        }
      },
    });

    const result = await reindexEntity(
      stack.db,
      stack.registry,
      deletingAdapter,
      "widget",
      admin.tenantId,
      { batchSize: 2 },
    );

    expect(result.scannedRows).toBe(rowsBeforeScan);
    expect(result.failures).toHaveLength(0);
  });

  test("a row soft-deleted between the batch read and the write leaves nothing in the index", async () => {
    const executor = seedExecutor();
    const created = await executor.create({ name: "Racedelete Widget" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("seed failed");

    const result = await reindexEntity(
      stack.db,
      stack.registry,
      stack.search,
      "widget",
      admin.tenantId,
      {
        afterBatchRead: async () => {
          const deleted = await executor.delete({ id: created.data.id }, admin, tenantDb());
          if (!deleted.isSuccess) throw new Error("delete failed");
        },
      },
    );

    expect(result.failures).toHaveLength(0);
    const hits = await stack.search.search(admin.tenantId, "racedelete", { filterType: "widget" });
    expect(hits.some((hit) => hit.entityId === created.data.id)).toBe(false);
  });

  test("a row edited between the batch read and the write is rewritten with the new text", async () => {
    const executor = seedExecutor();
    const created = await executor.create({ name: "Raceedit Before" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("seed failed");

    await reindexEntity(stack.db, stack.registry, stack.search, "widget", admin.tenantId, {
      afterBatchRead: async () => {
        const updated = await executor.update(
          { id: created.data.id, changes: { name: "Raceedit After" } },
          admin,
          tenantDb(),
          { skipOptimisticLock: true },
        );
        if (!updated.isSuccess) throw new Error("update failed");
      },
    });

    const find = async (term: string) =>
      (await stack.search.search(admin.tenantId, term, { filterType: "widget" })).some(
        (hit) => hit.entityId === created.data.id,
      );
    expect(await find("before")).toBe(false);
    expect(await find("after")).toBe(true);
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

  // a searchable field with no matching read-table
  // column (dropped/never-migrated) used to push one identical failures[]
  // entry per scanned row instead of failing fast — fails loud on the first
  // row's column set instead, which is invariant across the whole scan.
  test("throws immediately when a searchable field has no matching column, without scanning every row", async () => {
    const executor = createEventStoreExecutor(gadgetTable, gadgetEntity, { entityName: "gadget" });
    await executor.create({ name: "Row A" }, admin, tenantDb());
    await executor.create({ name: "Row B" }, admin, tenantDb());

    await asRawClient(stack.db).unsafe(`ALTER TABLE "read_reindex_gadgets" DROP COLUMN "name"`);
    await expect(
      reindexEntity(stack.db, stack.registry, stack.search, "gadget", admin.tenantId),
    ).rejects.toThrow(/searchable field "name" is not mappable/);
  });

  // reindexEntity read the read-table row (ciphertext for pii+
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
      createTenantDb({
        db: stack.db,
        tenantId: admin.tenantId,
        mode: "system",
        reason: "test reindex reads entity rows across tenants",
      }),
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
      createTenantDb({
        db: stack.db,
        tenantId: admin.tenantId,
        mode: "system",
        reason: "test reindex reads entity rows across tenants",
      }),
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

describe("reindexEntity connection lifecycle", () => {
  test("a reindex abandoned while its adapter stalls does not keep the database open after cleanup", async () => {
    const ownStack = await setupTestStack({ features: [widgetFeature] });
    try {
      await unsafeCreateEntityTable(ownStack.db, widgetEntity);
      const created = await seedExecutor().create(
        { name: "Stalled Widget" },
        admin,
        createTenantDb({
          db: ownStack.db,
          tenantId: admin.tenantId,
          mode: "system",
          reason: "test reindex reads entity rows across tenants",
        }),
      );
      if (!created.isSuccess) throw new Error("seed failed");

      const indexBatchReached = Promise.withResolvers<void>();
      const stallingAdapter: SearchAdapter = {
        ...ownStack.search,
        indexBatch: () => {
          indexBatchReached.resolve();
          return new Promise<void>(() => {});
        },
      };
      // Callers like a boot rebuild race this against their own timeout and move on.
      const run = reindexEntity(
        ownStack.db,
        ownStack.registry,
        stallingAdapter,
        "widget",
        admin.tenantId,
      );
      await Promise.race([
        indexBatchReached.promise,
        run.then(() => {
          throw new Error("reindex settled before indexBatch");
        }),
      ]);
    } catch (e) {
      await ownStack.cleanup();
      throw e;
    }

    await expect(ownStack.cleanup()).resolves.toBeUndefined();
  });
});
