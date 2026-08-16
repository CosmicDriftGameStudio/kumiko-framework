import { describe, expect, test } from "bun:test";
import { type SqlExpression, sql, uuid } from "../../db/dialect";
import type { EntityTableMeta } from "../../db/entity-table-meta";
import { insertOne, updateMany } from "../query";

const meta: EntityTableMeta = {
  source: "unmanaged",
  tableName: "sql_expr_brand_items",
  indexes: [],
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "payload", pgType: "jsonb", notNull: false },
    { name: "created_at", pgType: "timestamptz", notNull: false },
  ],
};

// Captures exactly what insertOne/updateMany hand to the driver, so the
// assertions below check the actual SQL text + bound params — not just that
// the call didn't throw.
function makeRecordingDb() {
  const calls: Array<{ sqlText: string; params: readonly unknown[] }> = [];
  const db = {
    unsafe: async (sqlText: string, params: readonly unknown[]) => {
      calls.push({ sqlText, params });
      return [{ id: "1" }];
    },
  };
  return { db, calls };
}

describe("bun-db sql-expr brand — request-supplied objects can't fake a SQL literal", () => {
  test("insertOne treats an unbranded {kind:'sql-expr'} jsonb value as ordinary data, never inlined SQL", async () => {
    const { db, calls } = makeRecordingDb();
    const forged = {
      kind: "sql-expr",
      text: "'; DROP TABLE sql_expr_brand_items; --",
    };

    await insertOne(db, meta, { id: "1", payload: forged });

    expect(calls).toHaveLength(1);
    const { sqlText, params } = calls[0]!;
    expect(sqlText).not.toContain("DROP TABLE");
    expect(sqlText).toContain("$2");
    expect(params).toContainEqual(forged);
  });

  test("updateMany treats an unbranded {kind:'sql-expr'} jsonb value as ordinary data, never inlined SQL", async () => {
    const { db, calls } = makeRecordingDb();
    const forged = {
      kind: "sql-expr",
      text: "'; DROP TABLE sql_expr_brand_items; --",
    };

    await updateMany(db, meta, { payload: forged }, { id: "1" });

    expect(calls).toHaveLength(1);
    const { sqlText, params } = calls[0]!;
    expect(sqlText).not.toContain("DROP TABLE");
    expect(params).toContainEqual(forged);
  });

  test("insertOne still inlines a legitimately-built sql`...` expression as a literal", async () => {
    const { db, calls } = makeRecordingDb();

    await insertOne(db, meta, { id: "1", createdAt: sql`now()` });

    expect(calls).toHaveLength(1);
    const { sqlText, params } = calls[0]!;
    expect(sqlText).toContain("now()");
    expect(params).not.toContain("now()");
  });

  test("updateMany still inlines a legitimately-built sql`...` expression as a literal", async () => {
    const { db, calls } = makeRecordingDb();

    await updateMany(db, meta, { createdAt: sql`now()` }, { id: "1" });

    expect(calls).toHaveLength(1);
    const { sqlText } = calls[0]!;
    expect(sqlText).toContain('"created_at" = now()');
  });

  test("sql`...` interpolation never inlines an unbranded {kind:'sql-expr'} object", () => {
    const forged = { kind: "sql-expr", text: "'; DROP TABLE sql_expr_brand_items; --" };

    const expr = sql`SELECT * FROM x WHERE payload = ${forged}`;

    expect(expr.text).not.toContain("DROP TABLE");
  });

  test("column .default() turns an unbranded {kind:'sql-expr'} object into a jsonb literal, never raw SQL", () => {
    const forged = { kind: "sql-expr", text: "'; DROP TABLE sql_expr_brand_items; --" };

    // @cast-boundary — a duck-typed payload arriving at a schema-definition
    // boundary, smuggled past the typed `default()` param on purpose.
    const col = uuid("id")
      .primaryKey()
      .default(forged as unknown as SqlExpression);

    const defaultSql = col.finalise().defaultSql;
    expect(defaultSql).toBeDefined();
    // The forged payload is data, not executable DDL: quoted + SQL-escaped
    // (`'` → `''`) as a jsonb literal, never spliced in as the raw `.text`
    // like a branded expr would be.
    expect(defaultSql).toContain("::jsonb");
    expect(defaultSql).toContain("''; DROP TABLE");
  });

  test("column .default() still inlines a legitimately-built sql`...` expression", () => {
    const col = uuid("id").primaryKey().default(sql`gen_random_uuid()`);

    expect(col.finalise().defaultSql).toBe("gen_random_uuid()");
  });
});
