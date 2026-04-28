// Unit-Tests für `required: true` → `.notNull()` Mapping in fieldToColumns.
//
// Vor diesem Fix war required nur bei reference-fields wirksam. text/select/
// number/etc. waren strukturell nullable in der DB, auch wenn der API-
// Validator required erzwungen hat. Folge: hand-written PgTable-Defs mit
// `.notNull()` als parallele Quelle, die unweigerlich gegen die r.entity-
// generierte Variante gedriftet sind. Hier: required muss durchschlagen,
// für jeden Field-Type.

import { describe, expect, test } from "vitest";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createImageField,
  createLocatedTimestampField,
  createMoneyField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
} from "../../engine";
import type { ReferenceFieldDef } from "../../engine/types";
import { buildDrizzleTable } from "../table-builder";

// Reference-fields haben keinen Factory-Helper — direkt-typed inline.
function refField(args: Omit<ReferenceFieldDef, "type">): ReferenceFieldDef {
  return { type: "reference", ...args };
}

function colByName(table: ReturnType<typeof buildDrizzleTable>, dbName: string) {
  // Drizzle's PgTable proxies columns through both JS-prop-name and the
  // serialized "name" attribute. We need the underlying column.config to
  // read .notNull, which lives at runtime under the column instance. Simplest
  // robust path: iterate Object.values, match by name.
  for (const col of Object.values(table) as Array<{ name?: string; notNull?: boolean }>) {
    if (col && typeof col === "object" && col.name === dbName) return col;
  }
  throw new Error(`Column ${dbName} not found in table`);
}

describe("buildDrizzleTable — required: true → NOT NULL", () => {
  test("text field — required true makes column NOT NULL", () => {
    const entity = createEntity({
      fields: {
        title: createTextField({ required: true }),
        subtitle: createTextField({}),
      },
    });
    const tbl = buildDrizzleTable("widget", entity);
    expect(colByName(tbl, "title").notNull).toBe(true);
    expect(colByName(tbl, "subtitle").notNull).toBe(false);
  });

  test("select field — required true makes column NOT NULL", () => {
    const entity = createEntity({
      fields: {
        status: createSelectField({ options: ["a", "b"] as const, required: true }),
        tag: createSelectField({ options: ["x"] as const }),
      },
    });
    const tbl = buildDrizzleTable("widget", entity);
    expect(colByName(tbl, "status").notNull).toBe(true);
    expect(colByName(tbl, "tag").notNull).toBe(false);
  });

  test("number field — required true makes column NOT NULL", () => {
    const entity = createEntity({
      fields: {
        count: createNumberField({ required: true }),
        optional: createNumberField({}),
      },
    });
    const tbl = buildDrizzleTable("widget", entity);
    expect(colByName(tbl, "count").notNull).toBe(true);
    expect(colByName(tbl, "optional").notNull).toBe(false);
  });

  test("boolean field — required true makes column NOT NULL even without default", () => {
    const entity = createEntity({
      fields: {
        active: createBooleanField({ required: true }),
        archived: createBooleanField({}),
      },
    });
    const tbl = buildDrizzleTable("widget", entity);
    expect(colByName(tbl, "active").notNull).toBe(true);
    // Default ohne required ergibt notNull (default macht Spalte never-null)
    expect(colByName(tbl, "archived").notNull).toBe(true);
  });

  test("reference single — required true makes column NOT NULL", () => {
    const entity = createEntity({
      fields: {
        owner: refField({ entity: "user", required: true }),
        assignee: refField({ entity: "user" }),
      },
    });
    const tbl = buildDrizzleTable("task", entity);
    expect(colByName(tbl, "owner").notNull).toBe(true);
    expect(colByName(tbl, "assignee").notNull).toBe(false);
  });

  test("date / timestamp / tz — required true makes column NOT NULL", () => {
    const entity = createEntity({
      fields: {
        bornOn: createDateField({ required: true }),
        bornOnOpt: createDateField({}),
        observedAt: createTimestampField({ required: true }),
        observedAtOpt: createTimestampField({}),
        zone: createTzField({ required: true }),
        zoneOpt: createTzField({}),
      },
    });
    const tbl = buildDrizzleTable("event", entity);
    expect(colByName(tbl, "born_on").notNull).toBe(true);
    expect(colByName(tbl, "born_on_opt").notNull).toBe(false);
    expect(colByName(tbl, "observed_at").notNull).toBe(true);
    expect(colByName(tbl, "observed_at_opt").notNull).toBe(false);
    expect(colByName(tbl, "zone").notNull).toBe(true);
    expect(colByName(tbl, "zone_opt").notNull).toBe(false);
  });

  test("locatedTimestamp — required true → BOTH columns NOT NULL", () => {
    const entity = createEntity({
      fields: {
        pickup: createLocatedTimestampField({ required: true }),
        dropoff: createLocatedTimestampField({}),
      },
    });
    const tbl = buildDrizzleTable("transport", entity);
    expect(colByName(tbl, "pickup_utc").notNull).toBe(true);
    expect(colByName(tbl, "pickup_tz").notNull).toBe(true);
    expect(colByName(tbl, "dropoff_utc").notNull).toBe(false);
    expect(colByName(tbl, "dropoff_tz").notNull).toBe(false);
  });

  test("multiSelect — always NOT NULL (default [] semantics)", () => {
    const entity = createEntity({
      fields: {
        roles: createMultiSelectField({ options: ["admin", "user"] as const }),
      },
    });
    const tbl = buildDrizzleTable("acl", entity);
    expect(colByName(tbl, "roles").notNull).toBe(true);
  });

  test("embedded — always NOT NULL (default {} semantics)", () => {
    const entity = createEntity({
      fields: {
        meta: { type: "embedded", fields: {} } as never,
      },
    });
    const tbl = buildDrizzleTable("widget", entity);
    expect(colByName(tbl, "meta").notNull).toBe(true);
  });

  test("money — required true → amount NOT NULL, currency always NOT NULL", () => {
    const entity = createEntity({
      fields: {
        price: createMoneyField({ required: true }),
        discount: createMoneyField({}),
      },
    });
    const tbl = buildDrizzleTable("listing", entity);
    expect(colByName(tbl, "price").notNull).toBe(true);
    expect(colByName(tbl, "price_currency").notNull).toBe(true);
    expect(colByName(tbl, "discount").notNull).toBe(false);
    expect(colByName(tbl, "discount_currency").notNull).toBe(true);
  });

  test("image (single) — required true → NOT NULL", () => {
    const entity = createEntity({
      fields: {
        avatar: createImageField({ required: true }),
        cover: createImageField({}),
      },
    });
    const tbl = buildDrizzleTable("profile", entity);
    expect(colByName(tbl, "avatar").notNull).toBe(true);
    expect(colByName(tbl, "cover").notNull).toBe(false);
  });

  test("reference multi — always NOT NULL (default [] semantics)", () => {
    const entity = createEntity({
      fields: {
        tags: refField({ entity: "tag", multiple: true }),
      },
    });
    const tbl = buildDrizzleTable("post", entity);
    expect(colByName(tbl, "tags").notNull).toBe(true);
  });
});
