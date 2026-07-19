import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { jobRunEntity } from "../job-run-table";

function pgTypeOf(table: unknown, dbName: string): string | undefined {
  const cols = (table as { columns?: ReadonlyArray<{ name: string; pgType?: string }> }).columns;
  return cols?.find((c) => c.name === dbName)?.pgType;
}

describe("jobRunEntity — DDL (#1205 regression)", () => {
  test("duration column is integer, not double precision", () => {
    const table = buildEntityTable("read_job_runs", jobRunEntity);
    expect(pgTypeOf(table, "duration")).toBe("integer");
  });
});
