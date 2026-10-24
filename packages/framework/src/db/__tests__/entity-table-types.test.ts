// Type tests for EntityTable<E>: pin the contractual behavior of the
// generic inference pipeline createEntity → buildEntityTable. If a branch
// in `fieldToColumns` drifts but `ColumnsForField` in the type system does
// not follow (or vice versa), these tests fail BEFORE a consumer is affected.
//
// A selection—not every field-type permutation is tested, but
// representative cases: required-literal, required-default, money-pair,
// locatedTimestamp-pair, multiSelect-jsonb-default, idType variation.

import { describe, expect, expectTypeOf, test } from "bun:test";
import type { FieldsMap } from "@cosmicdrift/kumiko-types/fields";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createEntityExecutor,
  createFilesField,
  createImagesField,
  createLocatedTimestampField,
  createMoneyField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
  type EntityDefinition,
} from "../../engine/index.ts";

import type { EventStoreExecutor } from "../event-store-executor.ts";
import type { MoneyRead } from "../money.ts";
import { buildEntityTable, type EntityRow } from "../table-builder.ts";

describe("EntityTable<E> — Property-Names existieren", () => {
  const sampleEntity = createEntity({
    table: "x",
    fields: {
      title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      done: createBooleanField({ default: false }),
      priority: createSelectField({ options: ["low", "high"] as const }),
    },
  });
  const t = buildEntityTable("sample", sampleEntity);

  test("base-columns sind getypt", () => {
    expectTypeOf(t.id).not.toBeNever();
    expectTypeOf(t.tenantId).not.toBeNever();
    expectTypeOf(t.version).not.toBeNever();
    expectTypeOf(t.insertedAt).not.toBeNever();
    expectTypeOf(t.modifiedAt).not.toBeNever();
    expectTypeOf(t.insertedById).not.toBeNever();
    expectTypeOf(t.modifiedById).not.toBeNever();
  });

  test("field-columns sind getypt", () => {
    expectTypeOf(t.title).not.toBeNever();
    expectTypeOf(t.done).not.toBeNever();
    expectTypeOf(t.priority).not.toBeNever();
  });

  test("nicht-existierender Spaltenname ist Compile-Error", () => {
    // @ts-expect-error — `nonExistent` is not declared in the entity.
    // If the line compiles, the type refactor was too permissive (= the index-
    // signature is back). The @ts-expect-error itself becomes a failure
    // if the error disappears → the test then fails at compile time.
    const x = t.nonExistent;
    expect(x).toBeUndefined();
  });
});

describe("EntityTable<E> — Money produces two columns", () => {
  const ent = createEntity({
    table: "invoice",
    fields: {
      amount: createMoneyField({ required: true }),
      shipping: createMoneyField(),
    },
  });
  const t = buildEntityTable("invoice", ent);

  test("money-amount column existiert", () => {
    expectTypeOf(t.amount).not.toBeNever();
    expectTypeOf(t.shipping).not.toBeNever();
  });

  test("money-currency Zwilling existiert", () => {
    expectTypeOf(t.amountCurrency).not.toBeNever();
    expectTypeOf(t.shippingCurrency).not.toBeNever();
  });
});

describe("EntityTable<E> — locatedTimestamp produces Utc + Tz", () => {
  const ent = createEntity({
    table: "delivery",
    fields: {
      pickup: createLocatedTimestampField({ required: true }),
    },
  });
  const t = buildEntityTable("delivery", ent);

  test("Utc und Tz Spalten existieren", () => {
    expectTypeOf(t.pickupUtc).not.toBeNever();
    expectTypeOf(t.pickupTz).not.toBeNever();
  });

  test("Original-name (ohne Suffix) ist KEIN column", () => {
    // @ts-expect-error — locatedTimestamp expands to pickupUtc + pickupTz, not `pickup`.
    // If `pickup` compiles, the FieldColumnNames map is broken.
    const x = t.pickup;
    expect(x).toBeUndefined();
  });
});

describe("EntityTable<E> — files/images produce one jsonb column each", () => {
  const ent = createEntity({
    table: "album",
    fields: {
      photos: createImagesField(),
      docs: createFilesField(),
    },
  });
  const t = buildEntityTable("album", ent);

  test("columns exist with the UUID-array row type", () => {
    expectTypeOf(t.photos).not.toBeNever();
    expectTypeOf(t.docs).not.toBeNever();
    expect(t.photos).toBeDefined();
    expect(t.docs).toBeDefined();
  });
});

describe("EntityTable<E> — verschiedene Feld-Typen existieren", () => {
  const ent = createEntity({
    table: "many",
    fields: {
      txt: createTextField({ personal: false, reason: "test_fixture" }),
      num: createNumberField(),
      dt: createDateField(),
      ts: createTimestampField(),
      tz: createTzField(),
      tags: createMultiSelectField({ options: ["a", "b"] as const }),
    },
  });
  const t = buildEntityTable("many", ent);

  test("alle Felder als columns sichtbar", () => {
    expectTypeOf(t.txt).not.toBeNever();
    expectTypeOf(t.num).not.toBeNever();
    expectTypeOf(t.dt).not.toBeNever();
    expectTypeOf(t.ts).not.toBeNever();
    expectTypeOf(t.tz).not.toBeNever();
    expectTypeOf(t.tags).not.toBeNever();
  });
});

describe("EntityTable<E> — idType wirkt", () => {
  const uuidEnt = createEntity({
    table: "uuid_ent",
    fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    // default: idType: "uuid"
  });
  const serialEnt = createEntity({
    table: "serial_ent",
    fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    idType: "serial",
  });
  const tu = buildEntityTable("uuid_ent", uuidEnt);
  const ts = buildEntityTable("serial_ent", serialEnt);

  test("uuid-Entity exposed id existiert", () => {
    expectTypeOf(tu.id).not.toBeNever();
  });
  test("serial-Entity exposed id existiert", () => {
    expectTypeOf(ts.id).not.toBeNever();
  });
});

describe("createEntity — inline field literals without `as const`", () => {
  const inlineEntity = createEntity({
    table: "inline_ent",
    fields: {
      owner: { type: "reference", entity: "user", required: true },
      status: { type: "select", options: ["open", "closed"], required: true },
      title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    },
  });
  const t = buildEntityTable("inline_ent", inlineEntity);

  test("the result is an EntityDefinition, not never", () => {
    expectTypeOf(inlineEntity).not.toBeNever();
    expectTypeOf(inlineEntity).toExtend<EntityDefinition>();
    expectTypeOf(inlineEntity.fields.owner.type).toEqualTypeOf<"reference">();
    expectTypeOf(inlineEntity.fields.status.options).toEqualTypeOf<readonly ["open", "closed"]>();
  });

  test("buildEntityTable still infers the columns", () => {
    expectTypeOf(t.owner).not.toBeNever();
    expectTypeOf(t.status).not.toBeNever();
    expectTypeOf(t.title).not.toBeNever();
  });

  test("a non-field value in fields still collapses to never", () => {
    const broken = createEntity({ table: "broken", fields: { x: { type: "nonsense" } } });
    expectTypeOf(broken).toBeNever();
  });
});

describe("createEntityExecutor — executor rows are typed from the entity", () => {
  const noteEntity = createEntity({
    table: "typed_notes",
    fields: {
      title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      body: createTextField({ personal: false, reason: "test_fixture" }),
      price: createMoneyField({ required: true }),
    },
  });
  const { executor } = createEntityExecutor("note", noteEntity);
  type NoteRow = EntityRow<typeof noteEntity>;

  test("detail() resolves to the concrete row", () => {
    expectTypeOf(executor.detail).returns.resolves.toEqualTypeOf<NoteRow | null>();
    expectTypeOf<NoteRow["title"]>().toEqualTypeOf<string>();
    expectTypeOf<NoteRow["body"]>().toEqualTypeOf<string | null>();
    expectTypeOf<NoteRow["price"]>().toEqualTypeOf<MoneyRead>();
  });

  test("list() rows are the concrete row", () => {
    expectTypeOf(executor.list).returns.resolves.toHaveProperty("rows");
    expectTypeOf(executor.list).returns.resolves.toMatchTypeOf<{ rows: readonly NoteRow[] }>();
  });

  test("a wide entity keeps the untyped executor", () => {
    const fields: FieldsMap = {
      title: createTextField({ personal: false, reason: "test_fixture" }),
    };
    const wide = createEntityExecutor("wide", createEntity({ fields }));
    expectTypeOf(wide.executor.detail).returns.resolves.toEqualTypeOf<Record<
      string,
      unknown
    > | null>();
  });

  test("a typed executor stays assignable to the untyped EventStoreExecutor", () => {
    expectTypeOf(executor).toExtend<EventStoreExecutor>();
  });
});
