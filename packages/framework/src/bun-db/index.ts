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
export type { SelectOptions, WhereObject, WhereOperator, WhereValue } from "./query";
export {
  asRawClient,
  countWhere,
  deleteMany,
  deleteManyBatched,
  type DeleteManyBatchedOptions,
  type DeleteManyBatchedResult,
  fetchOne,
  incrementCounter,
  type IncrementCounterOptions,
  insertMany,
  insertOne,
  selectMany,
  transaction,
  updateMany,
  upsertByPk,
  upsertOnConflict,
  type UpsertOnConflictOptions,
} from "./query";
