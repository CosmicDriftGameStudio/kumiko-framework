// extractTableInfo discriminator-shadow regression.
//
// EntityTableMeta carries a `source: "managed" | "unmanaged"` discriminator.
// table() (dialect) spreads the column handles as enumerable props over the
// meta object, so an entity field literally named `source` overwrote the
// discriminator → extractTableInfo failed the meta check, fell into the (dead)
// drizzle branch, and typed timestamptz columns via getSQLType() as
// "timestamp with time zone". prepareValue only serializes Temporal.Instant for
// "timestamptz" → a raw Temporal reached postgres-js → "Cannot use valueOf" on
// every create of such an entity (e.g. pattern-storage's pattern-file).

import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "../../db/table-builder";
import { extractTableInfo } from "../query";

describe("extractTableInfo — EntityTableMeta discriminator is shadow-proof", () => {
  test("an entity field named `source` does not shadow the discriminator", () => {
    const table = buildEntityTable("patternFile", {
      fields: {
        path: { type: "text", required: true },
        source: { type: "text", required: true },
      },
    });
    const info = extractTableInfo(table);
    // The framework-canonical pgType the bun-db serializer matches on — NOT the
    // drizzle getSQLType() spelling "timestamp with time zone".
    expect(info.pgTypeOf("inserted_at")).toBe("timestamptz");
    // The user-defined `source` column is still present + correctly typed.
    expect(info.pgTypeOf("source")).toBe("text");
  });

  test.each([
    "columns",
    "tableName",
    "indexes",
  ])("an entity field named `%s` (another meta key) also does not shadow it", (fieldName) => {
    const table = buildEntityTable("thing", {
      fields: { [fieldName]: { type: "text", required: true } },
    });
    const info = extractTableInfo(table);
    expect(info.pgTypeOf("inserted_at")).toBe("timestamptz");
  });

  test("control entity without a colliding field is unaffected", () => {
    const table = buildEntityTable("note", {
      fields: { title: { type: "text", required: true } },
    });
    const info = extractTableInfo(table);
    expect(info.pgTypeOf("inserted_at")).toBe("timestamptz");
  });
});
