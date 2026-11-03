// The generator emits the column drop commented out, with a guard in front. Uncommenting both
// must refuse a column that still holds values and drop an empty one.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../entity-table-meta.ts";
import { diffSnapshots, renderMigrationSql, snapshotFromMetas } from "../migrate-generator.ts";
import { asRawClient } from "../query.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const TABLE = "kdrop_guard";
const COLUMN = "legacy";

function meta(withLegacy: boolean): EntityTableMeta {
  return {
    tableName: TABLE,
    source: "unmanaged",
    indexes: [],
    columns: [
      { name: "id", pgType: "text", notNull: true, primaryKey: true },
      ...(withLegacy ? [{ name: COLUMN, pgType: "text" as const, notNull: false }] : []),
    ],
  };
}

function uncommentedGuardAndDrop(): string[] {
  const sql = renderMigrationSql(
    diffSnapshots(snapshotFromMetas([meta(true)]), snapshotFromMetas([meta(false)])),
    { name: "drop-legacy", sequenceNumber: 2 },
  );
  return sql
    .split("\n")
    .filter((line) => line.startsWith("-- DO $$") || line.startsWith("-- DESTRUCTIVE: ALTER"))
    .map((line) => line.replace(/^-- (DESTRUCTIVE: )?/, "").replace(/;\s+-- .*$/, ";"));
}

let testDb: BunTestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  const raw = asRawClient(testDb.db);
  await raw.unsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
  await raw.unsafe(`CREATE TABLE "${TABLE}" ("id" text PRIMARY KEY, "${COLUMN}" text)`);
});

async function columnExists(): Promise<boolean> {
  const rows = await asRawClient(testDb.db).unsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = '${TABLE}' AND column_name = '${COLUMN}'`,
  );
  return rows.length > 0;
}

describe("dropped column guard", () => {
  test("emits exactly the guard and the drop", () => {
    expect(uncommentedGuardAndDrop()).toHaveLength(2);
  });

  test("a column that still has values aborts the drop", async () => {
    const raw = asRawClient(testDb.db);
    await raw.unsafe(`INSERT INTO "${TABLE}" ("id", "${COLUMN}") VALUES ('a', 'still here')`);
    const [guard, drop] = uncommentedGuardAndDrop();
    await expect(raw.unsafe(guard ?? "")).rejects.toThrow(`${TABLE}.${COLUMN} is not empty`);
    expect(drop).toContain("DROP COLUMN");
    expect(await columnExists()).toBe(true);
  });

  test("an empty column passes the guard and is dropped", async () => {
    const raw = asRawClient(testDb.db);
    await raw.unsafe(`INSERT INTO "${TABLE}" ("id") VALUES ('a')`);
    for (const statement of uncommentedGuardAndDrop()) await raw.unsafe(statement);
    expect(await columnExists()).toBe(false);
  });
});
