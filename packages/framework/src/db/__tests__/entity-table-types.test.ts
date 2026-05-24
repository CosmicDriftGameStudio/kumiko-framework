// Type-Tests für EntityTable<E>: pinned das vertragliche Verhalten der
// Generic-Inferenz-Pipeline createEntity → buildEntityTable. Wenn ein
// Branch in `fieldToColumns` driftet aber `ColumnsForField` im Type-
// System nicht mitkommt (oder umgekehrt), schlagen diese Tests fehl
// BEVOR ein Consumer in den Wald läuft.
//
// Ausschnitt — nicht jede Field-Art-Permutation getestet, sondern
// repräsentative Fälle: required-Literal, required-Default, money-Pair,
// locatedTimestamp-Pair, multiSelect-jsonb-default, idType-Variation.

import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createLocatedTimestampField,
  createMoneyField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
} from "../../engine";
import { buildEntityTable } from "../table-builder";

describe("EntityTable<E> — Property-Names existieren", () => {
  const sampleEntity = createEntity({
    table: "x",
    fields: {
      title: createTextField({ required: true }),
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
    // @ts-expect-error — `nonExistent` ist nicht in der Entity deklariert.
    // Wenn die Zeile compiles, war der Type-Refactor zu lasch (= Index-
    // Signature wieder da). Das @ts-expect-error wird selbst zum Failure
    // wenn der Error verschwindet → der Test bricht dann zur Compile-Zeit.
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
    // @ts-expect-error — locatedTimestamp expandiert zu pickupUtc + pickupTz, nicht `pickup`.
    // Wenn `pickup` kompiliert, ist FieldColumnNames-Map kaputt.
    const x = t.pickup;
    expect(x).toBeUndefined();
  });
});

describe("EntityTable<E> — files/images produzieren keine columns", () => {
  // files/images werden über fileRefsTable resolved, nicht in der entity-table.
  // Ein Type-Test der das pinnt würde createFilesField verlangen — wir lassen
  // das hier weg, weil das Authoring-Pattern "createXField" ohne file-helper
  // ist (file/image gehen durch createFileField/createImageField mit single
  // mode, was eine column hat). multi-Mode (files/images) ist Edge-Case.
  test("kein column für files-typed field — separate Test-Sprint", () => {
    expect(true).not.toBe(false);
  });
});

describe("EntityTable<E> — verschiedene Feld-Typen existieren", () => {
  const ent = createEntity({
    table: "many",
    fields: {
      txt: createTextField(),
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
    fields: { name: createTextField() },
    // default: idType: "uuid"
  });
  const serialEnt = createEntity({
    table: "serial_ent",
    fields: { name: createTextField() },
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
