import { describe, expect, test } from "bun:test";
import type { ColumnMeta } from "../../db/entity-table-meta";
import { fileRefsTable } from "../file-ref-table";

// `fileRefsTable` is the live buildEntityTable() output the app boots with.
// Its runtime shape is a SchemaTable (EntityTableMeta & drizzle table), so the
// EntityTableMeta `columns` carry the resolved NOT NULL / DEFAULT per column —
// the drizzle-facing static type (EntityTable<E>) hides them, hence the cast.
// Importing fileRefEntity directly here would hit the engine↔file-ref-table
// init cycle (biome sorts it before file-ref-table); going through the built
// table sidesteps it and tests the exact object production uses.
const columns = (fileRefsTable as unknown as { readonly columns: readonly ColumnMeta[] }).columns;
const col = (name: string): readonly ColumnMeta[] => columns.filter((c) => c.name === name);

describe("fileRefEntity base-column drift", () => {
  // Regression: an earlier revision declared `insertedAt`/`insertedById` as
  // entity fields. The field-column then OVERRODE the framework base column in
  // the {...base, ...field} last-wins merge (entity-table-meta.ts), dropping
  // its NOT NULL DEFAULT now() and making inserted_at silently nullable — a
  // production INSERT could then leave it null. Re-adding either field shadows
  // the base column again and turns these red.
  test("inserted_at stays NOT NULL DEFAULT now() (base column, not field-shadowed)", () => {
    const insertedAt = col("inserted_at");
    expect(insertedAt).toHaveLength(1); // exactly one — not duplicated by a redeclared field
    expect(insertedAt[0]?.notNull).toBe(true);
    expect(insertedAt[0]?.defaultSql).toBe("now()");
  });

  test("inserted_by_id stays framework-managed nullable (not redeclared as a required field)", () => {
    const insertedById = col("inserted_by_id");
    expect(insertedById).toHaveLength(1);
    expect(insertedById[0]?.notNull).toBe(false);
  });
});
