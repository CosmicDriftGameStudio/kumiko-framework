// Test-only ES-bypass: seed / mutate a managed projection directly, skipping
// the event log. Production code CANNOT do this — the write helpers reject a
// branded EntityTable at compile time (#742). Tests seed read-model state to
// arrange a scenario without driving the full event path; a projection rebuild
// is not part of the test lifecycle, so eventless writes are safe here. The
// `as EntityTableMeta` strips the executor-only brand at this single sanctioned
// seam — the signatures mirror the query helpers so a call-site migration is a
// plain identifier rename.

import {
  type AnyDb,
  deleteMany,
  insertMany,
  insertOne,
  updateMany,
  type WhereObject,
} from "../bun-db/query";
import type { EntityTableMeta } from "../db/entity-table-meta";
import type { EntityTable } from "../db/table-builder";

type SeedTable = EntityTable | EntityTableMeta;

export function seedRow<TRow = unknown>(
  db: AnyDb,
  table: SeedTable,
  values: Record<string, unknown>,
): Promise<TRow | undefined> {
  return insertOne<TRow>(db, table as EntityTableMeta, values);
}

export function seedRows<TRow = unknown>(
  db: AnyDb,
  table: SeedTable,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<readonly TRow[]> {
  return insertMany<TRow>(db, table as EntityTableMeta, rows);
}

export function updateRows<TRow = unknown>(
  db: AnyDb,
  table: SeedTable,
  set: Record<string, unknown>,
  where: WhereObject,
): Promise<readonly TRow[]> {
  return updateMany<TRow>(db, table as EntityTableMeta, set, where);
}

export function deleteRows(db: AnyDb, table: SeedTable, where: WhereObject): Promise<void> {
  return deleteMany(db, table as EntityTableMeta, where);
}
