// Helpers für bun-db SQL-Layer-Integration-Tests.
//
// Pattern: pro Test eine eigene Tabelle mit unique-Name (random-Suffix),
// damit concurrency=8 tests sich nicht in die Quere kommen. CREATE TABLE
// im before, DROP TABLE im after (auch bei test-fail damit Test-DB clean
// bleibt). KEINE TEMP TABLES — die wären connection-bound und bun.sql's
// Pool reused connections, was tests in zwei verschiedenen Pool-Slots
// in verschiedene "TEMP-Welten" stecken würde.
//
// Schema-Tabellen bestehen aus einer id (uuid) + den getesteten Spalten.

import { randomUUID } from "node:crypto";
import { createBunDbConnection, type BunDbConnection } from "../connection";
import type { EntityTableMeta, ColumnMeta } from "../../db/entity-table-meta";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";

// Singleton-Connection für die gesamte Test-Suite. Bun.SQL hat internen
// Pool — ein Connection-Wrapper reicht.
let dbInstance: { db: BunDbConnection; close: () => Promise<void> } | undefined;

export function getDb(): BunDbConnection {
  if (!dbInstance) {
    const conn = createBunDbConnection(DATABASE_URL, { maxConnections: 4 });
    dbInstance = { db: conn.db, close: conn.close };
  }
  return dbInstance.db;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = undefined;
  }
}

// Erzeugt einen pseudo-zufälligen Tabellen-Namen. snake-case, lower,
// nur a-z0-9_, max 50 chars (Postgres-Identifier-Limit ist 63).
export function uniqueTableName(prefix = "sqltest"): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${suffix}`;
}

// EntityTableMeta-Helper. id (uuid primary key) wird IMMER gesetzt; der
// Caller liefert nur die zusätzlichen Test-Spalten.
export function makeTableMeta(
  tableName: string,
  extraColumns: readonly ColumnMeta[],
): EntityTableMeta {
  return {
    tableName,
    source: "unmanaged",
    indexes: [],
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
  };
}

// CREATE TABLE-Statement aus EntityTableMeta. Minimaler DDL-Renderer —
// kein Index-Support, kein Komplex-Default. Genug für die Test-Matrix.
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

// Test-Wrapper: Tabelle anlegen, fn aufrufen, Tabelle droppen.
// fn bekommt {db, meta} — alle SQL-Operationen laufen direkt darauf.
export async function withTable<T>(
  columns: readonly ColumnMeta[],
  fn: (ctx: { db: BunDbConnection; meta: EntityTableMeta }) => Promise<T>,
  prefix?: string,
): Promise<T> {
  const db = getDb();
  const tableName = uniqueTableName(prefix);
  const meta = makeTableMeta(tableName, columns);
  await db.unsafe(renderCreateTable(meta));
  try {
    return await fn({ db, meta });
  } finally {
    await db.unsafe(`DROP TABLE IF EXISTS "${tableName}"`);
  }
}
