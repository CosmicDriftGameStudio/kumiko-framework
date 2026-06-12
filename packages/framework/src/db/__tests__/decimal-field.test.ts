import { describe, expect, test } from "bun:test";
import { createDecimalField, createEntity } from "../../engine/factories";
import { fieldToZod } from "../../engine/schema-builder";
import { buildEntityTableMeta } from "../entity-table-meta";
import { coerceRow, extractTableInfo } from "../query";
import { renderTableDdl } from "../render-ddl";
import { buildEntityTable } from "../table-builder";

// decimal field — Postgres numeric(precision, scale). A new framework
// primitive (not a port), so these are correctness-of-the-primitive checks:
// column mapping, DDL, the pg-string→number read codec, and the write-boundary
// Zod bounds. The read codec is the load-bearing one — pg returns numeric as a
// STRING, and a missed conversion feeds consumers a string that silently
// breaks arithmetic.

const entity = createEntity({
  table: "read_decimal_probe",
  fields: {
    sum: createDecimalField({ precision: 14, scale: 2, required: true }),
    interest: createDecimalField({ precision: 6, scale: 4, required: true }),
    rate: createDecimalField({ precision: 12, scale: 2 }),
  },
});

describe("decimal field — column + DDL", () => {
  test("maps to numeric(precision,scale) with required→NOT NULL", () => {
    const cols = new Map(
      buildEntityTableMeta("decimalProbe", entity).columns.map((c) => [c.name, c]),
    );
    expect(cols.get("sum")?.pgType).toBe("numeric(14,2)");
    expect(cols.get("interest")?.pgType).toBe("numeric(6,4)");
    expect(cols.get("rate")?.pgType).toBe("numeric(12,2)");
    expect(cols.get("sum")?.notNull).toBe(true);
    expect(cols.get("rate")?.notNull).toBe(false);
  });

  test("renders real numeric(p,s) DDL", () => {
    const ddl = renderTableDdl(buildEntityTableMeta("decimalProbe", entity)).join("\n");
    expect(ddl).toContain('"interest" numeric(6,4) NOT NULL');
    expect(ddl).toContain('"rate" numeric(12,2)');
  });
});

describe("decimal field — read codec (pg numeric string → JS number)", () => {
  const info = extractTableInfo(buildEntityTable("decimalProbe", entity));

  test("parses numeric strings to exact numbers", () => {
    // Record<string, unknown> so coerceRow's pass-through return type doesn't
    // pin the keys to `string` — the runtime value is the coerced number.
    const input: Record<string, unknown> = { sum: "1000.50", interest: "2.5000", rate: "5.83" };
    const row = coerceRow(input, info);
    expect(row["sum"]).toBe(1000.5);
    expect(row["interest"]).toBe(2.5);
    expect(row["rate"]).toBe(5.83);
    expect(typeof row["rate"]).toBe("number");
  });

  test("null passes through untouched", () => {
    expect(coerceRow({ rate: null }, info).rate).toBeNull();
  });

  test("already-number values are left as-is", () => {
    expect(coerceRow({ interest: 2.5 }, info).interest).toBe(2.5);
  });
});

describe("decimal field — write-boundary Zod bounds", () => {
  const schema = fieldToZod(createDecimalField({ precision: 6, scale: 2 }), []);

  test("accepts values within precision and scale", () => {
    for (const v of [5.83, 2.5, 1000.5, -42.99, 0, 9999.99]) {
      expect(schema.safeParse(v).success).toBe(true);
    }
  });

  test("rejects more decimal places than scale", () => {
    expect(schema.safeParse(1.234).success).toBe(false);
  });

  test("rejects values exceeding the precision−scale integer digits", () => {
    // precision 6, scale 2 → at most 4 integer digits → |value| < 10000.
    expect(schema.safeParse(10000).success).toBe(false);
    expect(schema.safeParse(-10000).success).toBe(false);
  });
});

describe("decimal field — factory", () => {
  test("requires precision and scale, defaults to optional", () => {
    const f = createDecimalField({ precision: 8, scale: 3 });
    expect(f.type).toBe("decimal");
    expect(f.precision).toBe(8);
    expect(f.scale).toBe(3);
    expect(f.required).toBe(false);
  });
});

describe("known limitation: precision past 2^53 (same trade-off as bigInt number-mode)", () => {
  test("a numeric string beyond Number.MAX_SAFE_INTEGER loses precision on read", () => {
    const e = createEntity({
      table: "read_decimal_big",
      fields: { big: createDecimalField({ precision: 20, scale: 0 }) },
    });
    const info = extractTableInfo(buildEntityTable("decimalBig", e));
    // 2^53 + 1 → surfaced as JS number rounds to 2^53. Documented, not a bug:
    // keep precision − scale ≤ 15 to stay exact (see DecimalFieldDef doc).
    const input: Record<string, unknown> = { big: "9007199254740993" };
    expect(coerceRow(input, info)["big"]).toBe(2 ** 53);
  });
});
