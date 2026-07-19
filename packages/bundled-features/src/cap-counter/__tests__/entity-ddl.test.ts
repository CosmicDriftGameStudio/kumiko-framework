import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { capCounterEntity } from "../entity";

function pgTypeOf(table: unknown, dbName: string): string | undefined {
  const cols = (table as { columns?: ReadonlyArray<{ name: string; pgType?: string }> }).columns;
  return cols?.find((c) => c.name === dbName)?.pgType;
}

describe("capCounterEntity — DDL (#1205 regression)", () => {
  test("value column is bigint, not double precision", () => {
    const table = buildEntityTable("cap-counter", capCounterEntity);
    expect(pgTypeOf(table, "value")).toBe("bigint");
  });
});
