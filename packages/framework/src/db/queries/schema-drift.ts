import type { AnyDb } from "../query";
import { asRawClient } from "../query";

export type AppliedMigrationRow = {
  readonly hash: string;
  readonly created_at: bigint | number | null;
};

export type DbColumnInfoRow = {
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: "YES" | "NO";
};

/** tableRef must be `drizzle.__drizzle_migrations` or `public.__drizzle_migrations`. */
export async function selectAppliedMigrations(
  db: AnyDb,
  tableRef: "drizzle.__drizzle_migrations" | "public.__drizzle_migrations",
): Promise<readonly AppliedMigrationRow[]> {
  return (await asRawClient(db).unsafe(
    `SELECT hash, created_at FROM ${tableRef} ORDER BY id`,
  )) as readonly AppliedMigrationRow[];
}

export async function selectPublicTableColumns(
  db: AnyDb,
  tableName: string,
): Promise<readonly DbColumnInfoRow[]> {
  return (await asRawClient(db).unsafe(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  )) as readonly DbColumnInfoRow[];
}
