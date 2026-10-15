import { describe, expect, test } from "bun:test";
import { defineUnmanagedTable, deriveEntityTableMeta } from "../entity-table-meta.js";
import { buildEntityTable } from "../table-builder.js";
import {
  asEntityTableMeta,
  columnHandleName,
  columnSqlNameOf,
  hasFieldProperty,
  isEntityTableMeta,
  requireEntityTableMeta,
  schemaTableName,
  tableColumnsOf,
  tableNameOf,
} from "../table-introspection.js";

const noteEntity = { fields: { title: { type: "text", required: true } } } as const;

describe("isEntityTableMeta", () => {
  test("accepts managed and unmanaged metas", () => {
    expect(isEntityTableMeta(deriveEntityTableMeta("note", noteEntity))).toBe(true);
    expect(isEntityTableMeta(defineUnmanagedTable({ tableName: "store_note", columns: [] }))).toBe(
      true,
    );
  });

  test("rejects non-objects and partial shapes", () => {
    expect(isEntityTableMeta(null)).toBe(false);
    expect(isEntityTableMeta("note")).toBe(false);
    expect(isEntityTableMeta({ tableName: "x", columns: [], indexes: [] })).toBe(false);
    expect(isEntityTableMeta({ tableName: "x", columns: [], indexes: [], source: "other" })).toBe(
      false,
    );
    expect(isEntityTableMeta({ tableName: 1, columns: [], indexes: [], source: "managed" })).toBe(
      false,
    );
  });
});

describe("asEntityTableMeta / requireEntityTableMeta", () => {
  test("resolves the meta of a built table and of a plain meta", () => {
    const table = buildEntityTable("note", noteEntity);
    expect(asEntityTableMeta(table)?.tableName).toBe(schemaTableName(table));
    const plain = deriveEntityTableMeta("note", noteEntity);
    expect(asEntityTableMeta(plain)).toBe(plain);
  });

  test.each(["source", "columns", "tableName", "indexes"])(
    "a column named `%s` does not shadow the canonical meta",
    (fieldName) => {
      const table = buildEntityTable("thing", {
        fields: { [fieldName]: { type: "text", required: true } },
      });
      const meta = asEntityTableMeta(table);
      expect(meta?.source).toBe("managed");
      expect(meta?.tableName).toBe(schemaTableName(table));
      expect(Array.isArray(meta?.columns)).toBe(true);
    },
  );

  test("returns undefined for foreign values; require throws with the caller label", () => {
    expect(asEntityTableMeta(undefined)).toBeUndefined();
    expect(asEntityTableMeta({ tableName: "x" })).toBeUndefined();
    expect(() => requireEntityTableMeta({}, "myCaller")).toThrow(/myCaller: table carries no/);
  });
});

describe("table name and column lookups", () => {
  const table = buildEntityTable("note", {
    fields: { title: { type: "text", required: true }, tableName: { type: "text" } },
  });

  test("schemaTableName reads the name symbol, tableNameOf falls back to meta then <unknown>", () => {
    const name = schemaTableName(table);
    expect(typeof name).toBe("string");
    expect(tableNameOf(table)).toBe(name ?? "");
    const plain = deriveEntityTableMeta("note", noteEntity);
    expect(schemaTableName(plain)).toBeUndefined();
    expect(tableNameOf(plain)).toBe(plain.tableName);
    expect(tableNameOf({})).toBe("<unknown>");
    expect(tableNameOf(null)).toBe("<unknown>");
  });

  test("column lookups resolve handles and ignore non-tables", () => {
    expect(columnSqlNameOf(table, "title")).toBe("title");
    expect(columnHandleName(table, "title")).toBe("title");
    expect(columnSqlNameOf(table, "missing")).toBeUndefined();
    expect(Object.keys(tableColumnsOf(table) ?? {})).toContain("title");
    expect(tableColumnsOf({})).toBeUndefined();
    expect(tableColumnsOf("x")).toBeUndefined();
    expect(columnHandleName(null, "title")).toBeUndefined();
  });

  test("hasFieldProperty reports defined properties only", () => {
    expect(hasFieldProperty({ tenantId: {} }, "tenantId")).toBe(true);
    expect(hasFieldProperty({ tenantId: undefined }, "tenantId")).toBe(false);
    expect(hasFieldProperty(null, "tenantId")).toBe(false);
  });
});
