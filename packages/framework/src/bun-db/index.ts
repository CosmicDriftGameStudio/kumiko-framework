// bun-db: Bun.sql-basierte DB-API ohne drizzle.
// Production-Pfad nach drizzle-removal.

export type {
  BunDbConnection,
  BunDbConnectionOptions,
  BunDbRunner,
  BunDbTx,
  PgListenClient,
} from "./connection";
export { bunDbConnectionOptionsFromEnv, createBunDbConnection } from "./connection";
export type { SelectOptions, TableInfo, WhereObject, WhereOperator, WhereValue } from "./query";
export {
  asEntityTableMeta,
  asRawClient,
  countWhere,
  type DeleteManyBatchedOptions,
  type DeleteManyBatchedResult,
  deleteMany,
  deleteManyBatched,
  extractTableInfo,
  fetchOne,
  type IncrementCounterOptions,
  incrementCounter,
  insertMany,
  insertOne,
  selectMany,
  transaction,
  type UpsertOnConflictOptions,
  updateMany,
  upsertByPk,
  upsertOnConflict,
} from "./query";
