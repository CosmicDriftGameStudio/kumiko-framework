// Type-level contract for the ES-write brand (#742): the public write helpers
// reject a managed EntityTable at COMPILE time (executor-only), while reads on
// it and writes on unmanaged tables stay allowed. The bodies below are never
// invoked — tsc checks them, bun:test does not run them. Each `@ts-expect-error`
// turns into an "unused directive" compile error if the brand ever stops firing,
// so a regression breaks the build, not just this test.

import { expect, test } from "bun:test";
import { defineUnmanagedTable } from "../../db/entity-table-meta";
import { buildEntityTable } from "../../db/table-builder";
import type { TenantDb } from "../../db/tenant-db";
import { createEntity, createTextField } from "../../engine";
import { type AnyDb, deleteMany, insertOne, selectMany, updateMany } from "../query";

const brandedEntity = buildEntityTable(
  "brandSample",
  createEntity({ table: "brand_sample", fields: { title: createTextField({ required: true }) } }),
);

const unmanagedTable = defineUnmanagedTable({
  tableName: "brand_unmanaged",
  columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
});

async function _writeRejectsManagedEntity(db: AnyDb): Promise<void> {
  // @ts-expect-error — managed EntityTable is executor-only; direct insert is a compile error.
  await insertOne(db, brandedEntity, { title: "x" });
  // @ts-expect-error — direct update on a managed EntityTable is rejected.
  await updateMany(db, brandedEntity, { title: "y" }, { id: "1" });
  // @ts-expect-error — direct delete on a managed EntityTable is rejected.
  await deleteMany(db, brandedEntity, { id: "1" });
}

async function _writeAllowsUnmanagedTable(db: AnyDb): Promise<void> {
  // Unmanaged tables carry no brand — direct writes stay allowed.
  await insertOne(db, unmanagedTable, { id: "1" });
  await deleteMany(db, unmanagedTable, { id: "1" });
}

async function _readAllowsManagedEntity(db: AnyDb): Promise<void> {
  // Reads on a managed EntityTable are always fine (reads keep the permissive param).
  await selectMany(db, brandedEntity, { id: "1" });
}

// Method-form (ctx.db.insertOne/updateMany/deleteMany) rejects the brand too — a
// projection written past its event stream is wiped on rebuild whether the write
// went through the free function or the TenantDb method.
async function _methodFormRejectsManagedEntity(db: TenantDb): Promise<void> {
  // @ts-expect-error — managed EntityTable is executor-only; method-form insert is a compile error.
  await db.insertOne(brandedEntity, { title: "x" });
  // @ts-expect-error — method-form update on a managed EntityTable is rejected.
  await db.updateMany(brandedEntity, { title: "y" }, { id: "1" });
  // @ts-expect-error — method-form delete on a managed EntityTable is rejected.
  await db.deleteMany(brandedEntity, { id: "1" });
}

async function _methodFormReadAllowsManagedEntity(db: TenantDb): Promise<void> {
  // Method-form reads on a managed EntityTable stay fine (reads keep the plain param).
  await db.selectMany(brandedEntity, { id: "1" });
  await db.fetchOne(brandedEntity, { id: "1" });
}

test("ES-write brand: compile-time contracts are wired", () => {
  expect(_writeRejectsManagedEntity).toBeDefined();
  expect(_writeAllowsUnmanagedTable).toBeDefined();
  expect(_readAllowsManagedEntity).toBeDefined();
  expect(_methodFormRejectsManagedEntity).toBeDefined();
  expect(_methodFormReadAllowsManagedEntity).toBeDefined();
});
