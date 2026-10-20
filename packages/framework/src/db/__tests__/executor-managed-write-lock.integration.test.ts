import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { createRegistry } from "../../engine/registry.ts";
import { AccessDeniedError } from "../../errors/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../dialect.ts";
import { defineUnmanagedTable, type EntityTableMeta } from "../entity-table-meta.ts";
import { isExecutorManagedTable, markExecutorManagedTable } from "../executor-managed-tables.ts";
import {
  asEntityTableMeta,
  deleteMany,
  deleteManyBatched,
  insertOne,
  runInSavepointIfSupported,
  selectMany,
  updateMany,
  upsertOnConflict,
} from "../query.ts";
import { buildEntityTable } from "../table-builder.ts";
import {
  createTenantDataDestroyDb,
  createTenantDb,
  withExecutorManagedWrites,
  withoutExecutorManagedWrites,
} from "../tenant-db.ts";

const entity = createEntity({
  table: "read_managed_lock_items",
  fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
});
const managedTable = buildEntityTable("managedLockItem", entity);
// Deliberate bypass attempt: the compile-time ExecutorOnly brand is erased, only the runtime lock is left.
const erasedManagedTable = managedTable as unknown as EntityTableMeta;

const unmanagedTable = defineUnmanagedTable({
  tableName: "store_managed_lock_free",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "label", pgType: "text", notNull: true },
  ],
});

const projectionTable = pgTable("read_managed_lock_projection", {
  id: pgUuid("id").primaryKey(),
  label: pgText("label").notNull(),
});

const globalManagedTable = defineUnmanagedTable({
  tableName: "store_managed_lock_global",
  tenancy: "global",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "label", pgType: "text", notNull: true },
  ],
});
markExecutorManagedTable(globalManagedTable);

const tenantId = TestUsers.admin.tenantId;
const grant = { reason: "executor-managed-write-lock test" };
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "managedLockItem");
  await unsafePushTables(testDb.db, {
    unmanaged: unmanagedTable,
    global: globalManagedTable,
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

async function expectDenied(promise: Promise<unknown> | (() => Promise<unknown>)) {
  const settled = typeof promise === "function" ? promise() : promise;
  await expect(settled).rejects.toBeInstanceOf(AccessDeniedError);
}

describe("executor-managed write lock: raw runner", () => {
  test("the free writers reject a buildEntityTable table", async () => {
    await expectDenied(async () => insertOne(testDb.db, erasedManagedTable, { name: "x" }));
    await expectDenied(async () =>
      updateMany(testDb.db, erasedManagedTable, { name: "y" }, { name: "x" }),
    );
    await expectDenied(async () => deleteMany(testDb.db, erasedManagedTable, { name: "x" }));
    await expectDenied(async () =>
      upsertOnConflict(testDb.db, erasedManagedTable, { name: "x" }, { conflictKeys: ["id"] }),
    );
    await expectDenied(async () =>
      deleteManyBatched(testDb.db, erasedManagedTable, { name: "x" }, { limit: 10 }),
    );
    expect(await selectMany(testDb.db, managedTable, {})).toHaveLength(0);
  });

  test("an erased EntityTableMeta cast does not get around the lock", async () => {
    const erased = erasedManagedTable;
    await expectDenied(async () => insertOne(testDb.db, erased, { name: "x" }));
    await expectDenied(async () => deleteMany(testDb.db, erased, { name: "x" }));
  });

  test("the meta object taken from the table is locked too", async () => {
    const meta = asEntityTableMeta(managedTable);
    expect(meta).toBeDefined();
    expect(isExecutorManagedTable(meta)).toBe(true);
    await expectDenied(async () => insertOne(testDb.db, meta as EntityTableMeta, { name: "x" }));
  });
});

describe("executor-managed write lock: TenantDb", () => {
  test("TenantDb write methods reject a managed table", async () => {
    const tdb = createTenantDb({ db: testDb.db, tenantId });
    await expectDenied(tdb.insertOne(erasedManagedTable, { name: "x" }));
    await expectDenied(tdb.updateMany(erasedManagedTable, { name: "y" }, { name: "x" }));
    await expectDenied(tdb.deleteMany(erasedManagedTable, { name: "x" }));
  });

  test("db.global() writes reject a managed global table even with the escape hatch", async () => {
    const tdb = createTenantDb({ db: testDb.db, tenantId, grants: { globalWrites: grant } });
    const globalDb = tdb.global(globalManagedTable);
    await expectDenied(globalDb.insertOne({ label: "x" }));
    await expectDenied(globalDb.updateMany({ label: "y" }, { label: "x" }));
    await expectDenied(globalDb.deleteMany({ label: "x" }));
  });

  test("unsafeRaw does not unlock a managed table", async () => {
    const tdb = createTenantDb({ db: testDb.db, tenantId, grants: { unsafeRaw: grant } });
    await expectDenied(async () => insertOne(tdb.unsafeRaw(), erasedManagedTable, { name: "x" }));
  });

  test("unsafeRaw on a TenantDb over a capable runner still does not unlock", async () => {
    const tdb = createTenantDb({
      db: withExecutorManagedWrites(testDb.db),
      tenantId,
      grants: { unsafeRaw: grant },
    });
    await expectDenied(async () => insertOne(tdb.unsafeRaw(), erasedManagedTable, { name: "x" }));
    // the TenantDb itself still sits on the capable runner
    const row = await tdb.insertOne<{ id: string }>(erasedManagedTable, { name: "cap" });
    expect(row?.id).toBeDefined();
    await deleteMany(withExecutorManagedWrites(testDb.db), erasedManagedTable, { name: "cap" });
  });

  test("withoutExecutorManagedWrites returns the inner runner", () => {
    const capable = withExecutorManagedWrites(testDb.db);
    expect(capable).not.toBe(testDb.db);
    expect(withExecutorManagedWrites(capable)).toBe(capable);
    expect(withExecutorManagedWrites(testDb.db)).toBe(capable);
    expect(withoutExecutorManagedWrites(capable)).toBe(testDb.db);
    expect(withoutExecutorManagedWrites(testDb.db)).toBe(testDb.db);
  });
});

describe("executor-managed write lock: r.projection tables", () => {
  test("a table registered through r.projection is marked", () => {
    expect(isExecutorManagedTable(projectionTable)).toBe(false);
    createRegistry([
      defineFeature("managedlock", (r) => {
        r.entity({ name: "managedLockItem", ...entity });
        r.projection({
          name: "item-label",
          source: "managedLockItem",
          table: projectionTable,
          apply: {},
        });
      }),
    ]);
    expect(isExecutorManagedTable(projectionTable)).toBe(true);
  });
});

describe("executor-managed write lock: capable runner", () => {
  test("a capable runner writes, also inside a savepoint and a transaction", async () => {
    const capable = withExecutorManagedWrites(testDb.db);

    const direct = await insertOne<{ id: string }>(capable, erasedManagedTable, {
      name: "direct",
      tenantId,
    });
    expect(direct?.id).toBeDefined();

    await asTransaction(capable, async (tx) => {
      await insertOne(tx, erasedManagedTable, { name: "in-tx", tenantId });
      await runInSavepointIfSupported(tx, async (sp) => {
        await insertOne(sp, erasedManagedTable, { name: "in-savepoint", tenantId });
      });
    });

    const names = (await selectMany<{ name: string }>(testDb.db, managedTable, {})).map(
      (row) => row.name,
    );
    expect(names).toEqual(expect.arrayContaining(["direct", "in-tx", "in-savepoint"]));
    await deleteMany(capable, erasedManagedTable, { tenantId });
  });

  test("a plain transaction on the raw runner stays locked", async () => {
    await asTransaction(testDb.db, async (tx) => {
      await expectDenied(async () => insertOne(tx, erasedManagedTable, { name: "x" }));
    });
  });
});

describe("executor-managed write lock: unmanaged tables", () => {
  test("a defineUnmanagedTable table stays freely writable", async () => {
    const row = await insertOne<{ id: string }>(testDb.db, unmanagedTable, {
      tenantId,
      label: "free",
    });
    expect(row?.id).toBeDefined();
    await updateMany(testDb.db, unmanagedTable, { label: "freer" }, { id: row?.id });
    expect(await deleteMany(testDb.db, unmanagedTable, { id: row?.id })).toBe(1);
    const tdb = createTenantDb({ db: testDb.db, tenantId });
    expect(await tdb.insertOne(unmanagedTable, { label: "via-tenant-db" })).toBeDefined();
    await tdb.deleteMany(unmanagedTable, { label: "via-tenant-db" });
  });
});

async function asTransaction(runner: unknown, fn: (tx: unknown) => Promise<void>): Promise<void> {
  const begin = (runner as { begin: (cb: (tx: unknown) => Promise<void>) => Promise<void> }).begin;
  await begin.call(runner, fn);
}

describe("createTenantDataDestroyDb", () => {
  const otherTenantId = TestUsers.otherTenant.tenantId;

  test("deletes the pinned tenant's managed rows, leaves a foreign tenant's row, and keeps unsafeRaw locked", async () => {
    await seedRow(testDb.db, managedTable, { tenantId, name: "destroy-own" });
    await seedRow(testDb.db, managedTable, { tenantId: otherTenantId, name: "destroy-foreign" });

    const destroyDb = createTenantDataDestroyDb({
      db: testDb.db,
      tenantId,
      grants: { unsafeRaw: grant },
    });
    await deleteMany(destroyDb, erasedManagedTable, {
      name: { in: ["destroy-own", "destroy-foreign"] },
    });

    const remaining = await selectMany<{ name: string }>(testDb.db, erasedManagedTable, {
      name: { in: ["destroy-own", "destroy-foreign"] },
    });
    expect(remaining.map((row) => row.name)).toEqual(["destroy-foreign"]);

    await expectDenied(async () =>
      insertOne(destroyDb.unsafeRaw(), erasedManagedTable, { name: "x" }),
    );
  });
});
