import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { capCounterEntity } from "../entity.ts";
import { capReservationsTableMeta } from "../tables.ts";

function pgTypeOf(table: unknown, dbName: string): string | undefined {
  const cols = (table as { columns?: ReadonlyArray<{ name: string; pgType?: string }> }).columns;
  return cols?.find((c) => c.name === dbName)?.pgType;
}

describe("capCounterEntity — DDL (#1205 regression)", () => {
  test("value column is bigint, not double precision", () => {
    const table = buildEntityTable("cap-counter", capCounterEntity);
    expect(pgTypeOf(table, "value")).toBe("bigint");
  });

  test("reservation table carries the nullable settled_at tombstone column", () => {
    const column = capReservationsTableMeta.columns.find((c) => c.name === "settled_at");
    expect(column).toEqual({ name: "settled_at", pgType: "timestamptz", notNull: false });
  });
});
