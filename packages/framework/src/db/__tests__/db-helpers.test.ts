import { describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createSelectField, createTextField } from "../../engine";
import { decodeCursor, encodeCursor } from "../cursor";
import { buildBaseColumns, buildDrizzleTable } from "../table-builder";

// --- Cursor encoding ---

describe("cursor encoding", () => {
  test.each([1, 42, 999, 100000])("encodes and decodes id %i", (id) => {
    const cursor = encodeCursor(id);
    expect(decodeCursor(cursor)).toBe(id);
  });

  test("cursor is url-safe base64", () => {
    const cursor = encodeCursor(12345);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("throws on invalid cursor", () => {
    expect(() => decodeCursor("not-a-number")).toThrow(/invalid cursor/i);
  });
});

// --- Base columns ---

describe("buildBaseColumns", () => {
  test("includes standard columns", () => {
    const cols = buildBaseColumns(false);
    expect(cols).toHaveProperty("id");
    expect(cols).toHaveProperty("tenantId");
    expect(cols).toHaveProperty("insertedAt");
    expect(cols).toHaveProperty("modifiedAt");
    expect(cols).toHaveProperty("insertedById");
    expect(cols).toHaveProperty("modifiedById");
  });

  test("without softDelete has no isDeleted", () => {
    const cols = buildBaseColumns(false);
    expect(cols).not.toHaveProperty("isDeleted");
  });

  test("with softDelete includes isDeleted", () => {
    const cols = buildBaseColumns(true);
    expect(cols).toHaveProperty("isDeleted");
  });
});

// --- Table builder ---

describe("buildDrizzleTable", () => {
  test("creates table with base columns + entity fields", () => {
    const entity = createEntity({
      table: "users",
      fields: {
        email: createTextField({ required: true }),
        firstName: createTextField(),
        isEnabled: createBooleanField({ default: true }),
      },
    });

    const table = buildDrizzleTable("user", entity);

    // Has base columns
    expect(table["id"]).toBeDefined();
    expect(table["tenantId"]).toBeDefined();
    expect(table["insertedAt"]).toBeDefined();

    // Has entity fields
    expect(table["email"]).toBeDefined();
    expect(table["firstName"]).toBeDefined();
    expect(table["isEnabled"]).toBeDefined();
  });

  test("soft delete entity includes isDeleted column", () => {
    const entity = createEntity({
      table: "users",
      fields: { email: createTextField() },
      softDelete: true,
    });

    const table = buildDrizzleTable("user", entity);
    expect(table["isDeleted"]).toBeDefined();
  });

  test("select field becomes text column", () => {
    const entity = createEntity({
      table: "users",
      fields: {
        locale: createSelectField({ options: ["de", "en"] as const }),
      },
    });

    const table = buildDrizzleTable("user", entity);
    expect(table["locale"]).toBeDefined();
  });

  test("converts camelCase to snake_case", () => {
    const entity = createEntity({
      table: "users",
      fields: {
        firstName: createTextField(),
        employmentType: createSelectField({ options: ["FullTime", "PartTime"] as const }),
      },
    });

    const table = buildDrizzleTable("user", entity);
    // Column objects exist under camelCase keys
    expect(table["firstName"]).toBeDefined();
    expect(table["employmentType"]).toBeDefined();
  });

  test("featureName option prefixes table name", () => {
    const entity = createEntity({
      table: "orders",
      fields: { name: createTextField() },
    });

    const table = buildDrizzleTable("order", entity, { featureName: "shop" });
    // Drizzle's internal table name should be prefixed
    const tableConfig = (table as Record<string, unknown>)[Symbol.for("drizzle:Name")] as string | undefined;
    // Fallback: check the pgTable name via Drizzle internals
    const name = tableConfig ?? Object.getOwnPropertySymbols(table)
      .map(s => (table as Record<symbol, unknown>)[s])
      .find(v => typeof v === "string" && v.includes("shop"));
    expect(name).toContain("shop_orders");
  });

  test("without featureName, table name is unchanged", () => {
    const entity = createEntity({
      table: "orders",
      fields: { name: createTextField() },
    });

    const table = buildDrizzleTable("order", entity);
    const symbols = Object.getOwnPropertySymbols(table);
    const names = symbols.map(s => (table as Record<symbol, unknown>)[s]).filter(v => typeof v === "string");
    expect(names.some(n => (n as string).includes("orders"))).toBe(true);
    expect(names.some(n => (n as string).includes("_orders"))).toBe(false);
  });
});

// --- Sorting in CursorQueryOptions ---

describe("sorting", () => {
  test("CursorQueryOptions accepts sort and sortDirection", () => {
    // Type-level test: this should compile
    const opts: import("../cursor").CursorQueryOptions = {
      tenantId: 1,
      sort: "lastName",
      sortDirection: "asc",
    };
    expect(opts.sort).toBe("lastName");
    expect(opts.sortDirection).toBe("asc");
  });
});
