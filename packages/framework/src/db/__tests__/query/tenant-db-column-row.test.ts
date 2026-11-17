// Type-level contract for ctx.db.selectMany/fetchOne row inference. The bodies below are never
// invoked: tsc checks them, bun:test does not run them. Each `@ts-expect-error` becomes an
// "unused directive" compile error if the inference ever stops firing.

import { expect, test } from "bun:test";
import {
  createEntity,
  createJsonbField,
  createMoneyField,
  createTextField,
} from "../../../engine/index.ts";
import { defineUnmanagedTable } from "../../entity-table-meta.ts";
import { buildEntityTable } from "../../table-builder.ts";
import type { TenantDb } from "../../tenant-db.ts";

const sampleEntity = createEntity({
  table: "column_row_sample",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    note: createTextField({ personal: false, reason: "test_fixture" }),
    price: createMoneyField({ required: true }),
    payload: createJsonbField({ personal: false, reason: "test_fixture" }),
  },
});
const table = buildEntityTable("sample", sampleEntity);

const unmanagedTable = defineUnmanagedTable({
  tableName: "column_row_unmanaged",
  columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
});

async function _check(db: TenantDb): Promise<void> {
  const row = await db.fetchOne(table, { id: "x" });
  const _title: string | undefined = row?.title;
  const _note: string | null | undefined = row?.note;
  // @ts-expect-error — a ctx.db row has no folded money key
  const _folded = row?.price.amount;
  // @ts-expect-error — unknown column
  const _missing = row?.missing;

  const explicit = await db.selectMany<{ id: string }>(table);
  const _explicitId: string | undefined = explicit[0]?.id;

  const partial = await db.selectMany(table, {}, { fields: ["title"] });
  const _partial: readonly Record<string, unknown>[] = partial;

  const unmanaged = await db.selectMany(unmanagedTable);
  const _unmanaged: readonly Record<string, unknown>[] = unmanaged;

  expect([_title, _note, _folded, _missing, _explicitId, _partial, _unmanaged]).toBeDefined();
}

test("ctx.db rows: compile-time contracts are wired", () => {
  expect(_check).toBeDefined();
});
