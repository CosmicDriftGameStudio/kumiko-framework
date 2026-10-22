// Type-level contract for the ES-write lock: a write compiles only for a
// table carrying `Writable` or a runner carrying the executor capability. A managed
// EntityTable written without capability, or any table widened to a plain
// SchemaTable, is a COMPILE error while reads stay open. The bodies below are never
// invoked: tsc checks them, bun:test does not run them. Each `@ts-expect-error`
// becomes an "unused directive" compile error if the lock ever stops firing, so a
// regression breaks the build, not just this test.

import { expect, test } from "bun:test";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import type { MultiStreamApplyFn, SingleStreamApplyFn } from "@cosmicdrift/kumiko-types/projection";
import { createEntity, createTextField, type Registry } from "../../../engine/index.ts";
import { TestUsers } from "../../../seeding/seed-users.ts";
import type { DbRunner } from "../../connection.ts";
import {
  table as pgTable,
  text as pgText,
  uuid as pgUuid,
  type SchemaTable,
} from "../../dialect.ts";
import { entityTableFromRegistry } from "../../entity-table-from-registry.ts";
import { defineUnmanagedTable, deriveEntityTableMeta } from "../../entity-table-meta.ts";
import { type AnyDb, deleteMany, insertOne, selectMany, updateMany } from "../../query.ts";
import { buildEntityTable, declareGlobalTenancy } from "../../table-builder.ts";
import {
  createTenantDataDestroyDb,
  type ExecutorManagedTenantDb,
  type TenantDb,
} from "../../tenant-db.ts";

const brandSampleEntity = createEntity({
  table: "brand_sample",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const brandedEntity = buildEntityTable("brandSample", brandSampleEntity);

const unmanagedTable = defineUnmanagedTable({
  tableName: "brand_unmanaged",
  columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
});

const dialectTable = pgTable("brand_dialect", {
  id: pgUuid("id").primaryKey(),
  label: pgText("label").notNull(),
});

const derivedUnmanaged = deriveEntityTableMeta("brandSample", brandSampleEntity, {
  source: "unmanaged",
});

async function _writeRejectsManagedEntity(db: AnyDb): Promise<void> {
  // @ts-expect-error — managed EntityTable carries no Writable; direct insert is a compile error.
  await insertOne(db, brandedEntity, { title: "x" });
  // @ts-expect-error — direct update on a managed EntityTable is rejected.
  await updateMany(db, brandedEntity, { title: "y" }, { id: "1" });
  // @ts-expect-error — direct delete on a managed EntityTable is rejected.
  await deleteMany(db, brandedEntity, { id: "1" });
}

async function _writeAllowsUnmanagedTable(db: AnyDb): Promise<void> {
  await insertOne(db, unmanagedTable, { id: "1" });
  await deleteMany(db, unmanagedTable, { id: "1" });
}

async function _readAllowsManagedEntity(db: AnyDb): Promise<void> {
  // Reads on a managed EntityTable are always fine (reads keep the permissive param).
  await selectMany(db, brandedEntity, { id: "1" });
}

// Method-form (ctx.db.insertOne/updateMany/deleteMany) rejects managed tables too: a
// projection written past its event stream is wiped on rebuild whether the write
// went through the free function or the TenantDb method.
async function _methodFormRejectsManagedEntity(db: TenantDb): Promise<void> {
  // @ts-expect-error — managed EntityTable carries no Writable; method-form insert is a compile error.
  await db.insertOne(brandedEntity, { title: "x" });
  // @ts-expect-error — method-form update on a managed EntityTable is rejected.
  await db.updateMany(brandedEntity, { title: "y" }, { id: "1" });
  // @ts-expect-error — method-form delete on a managed EntityTable is rejected.
  await db.deleteMany(brandedEntity, { id: "1" });
}

async function _methodFormReadAllowsManagedEntity(db: TenantDb): Promise<void> {
  await db.selectMany(brandedEntity, { id: "1" });
  await db.fetchOne(brandedEntity, { id: "1" });
}

// 1. Widening a Writable table to SchemaTable drops the brand: erasure fails closed.
async function _widenedTableIsRejected(db: DbRunner): Promise<void> {
  const erased: SchemaTable = dialectTable;
  // @ts-expect-error — a table widened to plain SchemaTable no longer carries Writable.
  await insertOne(db, erased, { label: "x" });
}

// 2. A managed table from the registry, written with a runner that has no capability.
async function _registryTableNeedsCapability(db: DbRunner, registry: Registry): Promise<void> {
  const fromRegistry = entityTableFromRegistry(registry, "brandSample", brandSampleEntity);
  // @ts-expect-error — entityTableFromRegistry returns a plain SchemaTable, never Writable.
  await insertOne(db, fromRegistry, { title: "x" });
  // @ts-expect-error — a plain DbRunner has no executor capability for a managed table.
  await insertOne(db, brandedEntity, { title: "x" });
}

// 3. unsafeRaw() strips the capability; the TenantDb itself has none either.
async function _unsafeRawDoesNotUnlock(tenantDb: TenantDb): Promise<void> {
  // @ts-expect-error — unsafeRaw() returns a plain DbRunner without the capability.
  await insertOne(tenantDb.unsafeRaw(), brandedEntity, { title: "x" });
  // @ts-expect-error — a plain TenantDb only accepts Writable tables.
  await tenantDb.insertOne(brandedEntity, { title: "x" });
}

// 4. Even the capable TenantDb hands out a capability-free runner from unsafeRaw().
async function _capableUnsafeRawDoesNotUnlock(destroyDb: ExecutorManagedTenantDb): Promise<void> {
  // @ts-expect-error — unsafeRaw() on an ExecutorManagedTenantDb drops the capability.
  await insertOne(destroyDb.unsafeRaw(), brandedEntity, { title: "x" });
}

// 5. Apply functions receive the capability and the (managed) projection table.
const _singleStreamApplies: Record<string, SingleStreamApplyFn> = {
  "brandSample.created": async (_event, tx, table) => {
    await insertOne(tx, table, { title: "x" });
  },
};

const _multiStreamApplies: Record<string, MultiStreamApplyFn> = {
  "brandSample.created": async (_event, tx) => {
    await insertOne(tx, brandedEntity, { title: "x" });
    await deleteMany(tx, brandedEntity, { id: "1" });
  },
};

// 6. The tenant-destroy db writes managed tables, both as method and as free writer.
async function _tenantDestroyDbWritesManaged(
  destroyDb: ExecutorManagedTenantDb,
  runner: DbRunner,
): Promise<void> {
  await destroyDb.insertOne(brandedEntity, { title: "x" });
  await deleteMany(destroyDb, brandedEntity, { id: "1" });
  const created = createTenantDataDestroyDb({ db: runner, tenantId: TestUsers.admin.tenantId });
  await created.deleteMany(brandedEntity, { id: "1" });
}

// 7. kumiko-testing seeds hand the capability over themselves.
async function _seedRowAcceptsManaged(db: AnyDb): Promise<void> {
  await seedRow(db, brandedEntity, { title: "x" });
}

// 8. Every Writable constructor writes with a plain runner and a plain TenantDb.
async function _writableConstructorsWrite(db: DbRunner, tenantDb: TenantDb): Promise<void> {
  await insertOne(db, dialectTable, { label: "x" });
  await insertOne(db, unmanagedTable, { id: "1" });
  await insertOne(db, derivedUnmanaged, { title: "x" });
  await tenantDb.insertOne(dialectTable, { label: "x" });
  await tenantDb.insertOne(unmanagedTable, { id: "1" });
  await tenantDb.insertOne(derivedUnmanaged, { title: "x" });
}

async function _globalWrites(tenantDb: TenantDb): Promise<void> {
  const writableGlobal = declareGlobalTenancy(
    pgTable("brand_global", { label: pgText("label").notNull() }),
  );
  await tenantDb.global(writableGlobal).insertOne({ label: "x" });

  const managedGlobal = declareGlobalTenancy(brandedEntity);
  // @ts-expect-error — db.global() of a managed table exposes reads only.
  await tenantDb.global(managedGlobal).insertOne({ title: "x" });
}

test("ES-write brand: compile-time contracts are wired", () => {
  expect(_writeRejectsManagedEntity).toBeDefined();
  expect(_writeAllowsUnmanagedTable).toBeDefined();
  expect(_readAllowsManagedEntity).toBeDefined();
  expect(_methodFormRejectsManagedEntity).toBeDefined();
  expect(_methodFormReadAllowsManagedEntity).toBeDefined();
  expect(_widenedTableIsRejected).toBeDefined();
  expect(_registryTableNeedsCapability).toBeDefined();
  expect(_unsafeRawDoesNotUnlock).toBeDefined();
  expect(_capableUnsafeRawDoesNotUnlock).toBeDefined();
  expect(_singleStreamApplies).toBeDefined();
  expect(_multiStreamApplies).toBeDefined();
  expect(_tenantDestroyDbWritesManaged).toBeDefined();
  expect(_seedRowAcceptsManaged).toBeDefined();
  expect(_writableConstructorsWrite).toBeDefined();
  expect(_globalWrites).toBeDefined();
});
