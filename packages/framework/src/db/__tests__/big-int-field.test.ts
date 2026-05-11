// Unit-Tests fuer den BigInt-Field-Type — Atom 1a aus dem User-Data-
// Rights Async-Export-Plan.
//
// Pinst:
//   - createBigIntField liefert FieldDefinition.type === "bigInt"
//   - buildDrizzleTable mappt auf bigint(name, mode:"number"), nicht
//     integer (32-bit) → kein silent 2 GB-Cap
//   - Zod-Schema akzeptiert int + safe-integer + lehnt non-int + Float
//     + non-safe-integer ab
//   - required + sortable + filterable + default reisen durch
//
// Echter DB-Roundtrip-Test (Insert >2^31, Select, identisch zurueck)
// kommt mit Atom 1b sobald `exportJobEntity.bytesWritten` auf bigInt
// migriert ist + die existing integration-Tests die Tabelle wieder
// einrichten — pinst dort auf realer Postgres + Drizzle-customType-
// Path statt parallel-mock hier.

import { describe, expect, test } from "vitest";
import { createBigIntField, createEntity, createNumberField } from "../../engine";
import { buildInsertSchema } from "../../engine/schema-builder";
import { buildDrizzleTable } from "../table-builder";

function colByName(table: ReturnType<typeof buildDrizzleTable>, dbName: string) {
  for (const col of Object.values(table) as Array<{
    name?: string;
    notNull?: boolean;
    columnType?: string;
    dataType?: string;
  }>) {
    if (col && typeof col === "object" && col.name === dbName) return col;
  }
  throw new Error(`Column ${dbName} not found in table`);
}

describe("createBigIntField factory", () => {
  test("liefert FieldDef mit type='bigInt' + default required=false", () => {
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

describe("buildDrizzleTable — bigInt-Mapping", () => {
  test("bigInt-Spalte ist DISTINCT von number-Spalte (number=integer/32-bit, bigInt=bigint/64-bit)", () => {
    const entity = createEntity({
      fields: {
        smallCount: createNumberField({}),
        bigCount: createBigIntField({}),
      },
    });
    const table = buildDrizzleTable("counters", entity);

    const small = colByName(table, "small_count");
    const big = colByName(table, "big_count");

    // PgInteger vs PgBigint sind unterschiedliche columnType-Klassen in
    // Drizzle — der genaue String ist Drizzle-Internal aber MUSS
    // unterschiedlich sein, sonst geht der ganze 64-bit-Punkt verloren.
    expect(small.columnType).not.toBe(big.columnType);
  });

  test("required bigInt wird NOT NULL", () => {
    const entity = createEntity({
      fields: {
        requiredBig: createBigIntField({ required: true }),
        optionalBig: createBigIntField({}),
      },
    });
    const table = buildDrizzleTable("t", entity);
    expect(colByName(table, "required_big").notNull).toBe(true);
    expect(colByName(table, "optional_big").notNull).toBe(false);
  });
});

describe("buildInsertSchema — bigInt-Validation", () => {
  test("akzeptiert safe-integer-Werte inkl. >2^31", () => {
    const entity = createEntity({
      fields: { bytesWritten: createBigIntField({ required: true }) },
    });
    const schema = buildInsertSchema(entity);

    // 2^31 = 2_147_483_648 — Klassisches integer-Overflow-Pattern.
    expect(schema.parse({ bytesWritten: 2_147_483_648 })).toEqual({
      bytesWritten: 2_147_483_648,
    });
    // 2^50 — weit ueber integer, klar in bigInt-Territorium.
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
    // 2^53 = 9_007_199_254_740_992 ist Number.MAX_SAFE_INTEGER.
    // Werte ueber dem Cap koennen nicht round-trip-en ohne Praezisions-
    // Verlust — Zod's .safe() greift hier.
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
