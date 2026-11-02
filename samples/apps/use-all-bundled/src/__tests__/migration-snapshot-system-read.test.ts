// The checked-in migration snapshot must mark exactly the tables the framework
// marks systemRowsReadable; otherwise the generated RLS migration drops (or
// misses) the system-tenant read policy that the boot check demands.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectTableMetas } from "@cosmicdrift/kumiko-framework/db";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import kumikoConfig from "../../kumiko.config";

function snapshotSystemReadableTables(): string[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(import.meta.dir, "../../kumiko/migrations/.snapshot.json"), "utf8"),
  );
  const tables = isPlainObject(parsed) && Array.isArray(parsed["tables"]) ? parsed["tables"] : [];
  return tables
    .filter((table) => isPlainObject(table) && table["systemRowsReadable"] === true)
    .map((table) => String(isPlainObject(table) ? table["tableName"] : ""))
    .sort();
}

describe("use-all-bundled migration snapshot", () => {
  test("systemRowsReadable tables match the framework's table metas", () => {
    const expected = collectTableMetas(kumikoConfig.features)
      .filter((meta) => meta.systemRowsReadable === true)
      .map((meta) => meta.tableName)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(snapshotSystemReadableTables()).toEqual(expected);
  });
});
