// Each test gets its own table with a random suffix so tests running at
// concurrency=8 never collide. The table is dropped even when the test fails,
// keeping the test DB clean. No TEMP tables: they are bound to a connection,
// and the pool reuses connections, so two tests on different pool slots would
// see different TEMP namespaces.
//
// Test tables consist of an id (uuid) plus the columns under test.

import { randomUUID } from "node:crypto";
import type { WritableTable } from "@cosmicdrift/kumiko-types/executor-brand";
import { createDbConnection } from "../../connection.ts";
import {
  type ColumnMeta,
  defineUnmanagedTable,
  type EntityTableMeta,
} from "../../entity-table-meta.ts";

const DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";

let dbInstance: { db: unknown; close: () => Promise<void> } | undefined;

export async function getDb(): Promise<unknown> {
  return ensureDb();
}
// @wrapper-known test-helper
export async function ensureDb(): Promise<unknown> {
  if (!dbInstance) {
    dbInstance = createDbConnection({ url: DATABASE_URL, maxConnections: 4 });
  }
  return dbInstance.db;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = undefined;
  }
}

// Only a-z0-9_ and at most 50 chars, safely below the Postgres identifier limit of 63.
export function uniqueTableName(prefix = "sqltest"): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${suffix}`;
}

// The uuid primary key is always added; callers pass only the extra test columns.
export function makeTableMeta(
  tableName: string,
  extraColumns: readonly ColumnMeta[],
): WritableTable {
  return defineUnmanagedTable({
    tableName,
    columns: [
      {
        name: "id",
        pgType: "uuid",
        notNull: true,
        primaryKey: true,
        defaultSql: "gen_random_uuid()",
      },
      ...extraColumns,
    ],
  });
}

// Deliberately minimal DDL: no indexes and no complex defaults, which the test matrix does not need.
export function renderCreateTable(meta: EntityTableMeta): string {
  const cols = meta.columns
    .map((c) => {
      const parts = [`"${c.name}"`, c.pgType];
      if (c.notNull) parts.push("NOT NULL");
      if (c.defaultSql) parts.push(`DEFAULT ${c.defaultSql}`);
      if (c.primaryKey) parts.push("PRIMARY KEY");
      return parts.join(" ");
    })
    .join(", ");
  return `CREATE TABLE "${meta.tableName}" (${cols})`;
}

// Test wrapper: create a table, invoke fn, then drop the table.
// fn receives {db, meta}; all SQL operations run directly against that database connection.
export async function withTable<T>(
  columns: readonly ColumnMeta[],
  fn: (ctx: { db: unknown; meta: WritableTable }) => Promise<T>,
  prefix?: string,
): Promise<T> {
  const db = await getDb();
  const tableName = uniqueTableName(prefix);
  const meta = makeTableMeta(tableName, columns);
  const { asRawClient } = await import("../../query.ts");
  await asRawClient(db).unsafe(renderCreateTable(meta));
  try {
    return await fn({ db, meta });
  } finally {
    await asRawClient(db).unsafe(`DROP TABLE IF EXISTS "${tableName}"`);
  }
}
