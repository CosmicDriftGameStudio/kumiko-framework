// Unit tests for the BigInt field type.
//
// These tests verify:
//   - createBigIntField returns FieldDefinition.type === "bigInt"
//   - buildEntityTable maps to bigint(name, mode:"number"), not
//     integer (32-bit), avoiding a silent 2 GB cap
//   - The Zod schema accepts integers and safe integers, and rejects
//     non-integers, floats, and non-safe integers
//   - required, sortable, filterable, and default values are preserved
//
// A real database round-trip test (insert >2^31, select, and compare)
// requires `exportJobEntity.bytesWritten` to use bigInt and the existing
// integration tests to recreate the table. It belongs on the real
// Postgres and Drizzle-customType path rather than a parallel mock.

import { describe, expect, test } from "bun:test";
import { createBigIntField, createEntity, createNumberField } from "../../engine/index.ts";
import { buildInsertSchema } from "../../engine/schema-builder.ts";
import { buildEntityTable } from "../table-builder.ts";

function colByName(table: unknown, dbName: string) {
  const cols = (
    table as { columns?: ReadonlyArray<{ name: string; notNull?: boolean; pgType?: string }> }
  ).columns;
  if (!cols) throw new Error("Table has no columns metadata");
  for (const c of cols) {
    if (c.name === dbName) {
      return { name: c.name, notNull: c.notNull, columnType: c.pgType, dataType: c.pgType };
    }
  }
  throw new Error(`Column ${dbName} not found in table`);
}

describe("createBigIntField factory", () => {
  test("returns a FieldDef with type='bigInt' and default required=false", () => {
    const f = createBigIntField();
    expect(f.type).toBe("bigInt");
    expect(f.required).toBe(false);
  });

  test("Overrides reisen durch (required, sortable, filterable, default)", () => {
    const f = createBigIntField({
      required: true,
      sortable: true,
      filterable: true,
      default: 42,
    });
    expect(f.required).toBe(true);
    expect(f.sortable).toBe(true);
    expect(f.filterable).toBe(true);
    expect(f.default).toBe(42);
  });
});

describe("buildEntityTable — bigInt-Mapping", () => {
  test("bigInt column is DISTINCT from number column (number=integer/32-bit, bigInt=bigint/64-bit)", () => {
    const entity = createEntity({
      fields: {
        smallCount: createNumberField({}),
        bigCount: createBigIntField({}),
      },
    });
    const table = buildEntityTable("counters", entity);

    const small = colByName(table, "small_count");
    const big = colByName(table, "big_count");

    // PgInteger and PgBigint are different column type classes in
    // Drizzle. The exact string is an internal Drizzle detail, but they
    // MUST differ; otherwise the entire 64-bit guarantee is lost.
    expect(small.columnType).not.toBe(big.columnType);
  });

  test("required bigInt becomes NOT NULL", () => {
    const entity = createEntity({
      fields: {
        requiredBig: createBigIntField({ required: true }),
        optionalBig: createBigIntField({}),
      },
    });
    const table = buildEntityTable("t", entity);
    expect(colByName(table, "required_big").notNull).toBe(true);
    expect(colByName(table, "optional_big").notNull).toBe(false);
  });
});

describe("buildInsertSchema — bigInt-Validation", () => {
  test("accepts safe-integer values including >2^31", () => {
    const entity = createEntity({
      fields: { bytesWritten: createBigIntField({ required: true }) },
    });
    const schema = buildInsertSchema(entity);

    // 2^31 = 2_147_483_648 — Klassisches integer-Overflow-Pattern.
    expect(schema.parse({ bytesWritten: 2_147_483_648 })).toEqual({
      bytesWritten: 2_147_483_648,
    });
    // 2^50 is far beyond integer range and clearly within BigInt territory.
    expect(schema.parse({ bytesWritten: 2 ** 50 })).toEqual({
      bytesWritten: 2 ** 50,
    });
  });

  test("lehnt Float ab (silent-Truncation-Schutz)", () => {
    const entity = createEntity({
      fields: { count: createBigIntField({ required: true }) },
    });
    const schema = buildInsertSchema(entity);
    expect(() => schema.parse({ count: 1.5 })).toThrow();
  });

  test("lehnt non-safe-integer ab (>2^53)", () => {
    const entity = createEntity({
      fields: { count: createBigIntField({ required: true }) },
    });
    const schema = buildInsertSchema(entity);
    // 2^53 = 9_007_199_254_740_992 is Number.MAX_SAFE_INTEGER.
    // Values above this limit cannot round-trip without precision loss;
    // Zod's .safe() check rejects them.
    expect(() => schema.parse({ count: Number.MAX_SAFE_INTEGER + 2 })).toThrow();
  });

  test("default-Wert reist in Zod-Schema durch", () => {
    const entity = createEntity({
      fields: { count: createBigIntField({ default: 100 }) },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.parse({})).toEqual({ count: 100 });
  });
});
