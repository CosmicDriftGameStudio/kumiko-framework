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
  deleteMany,
  fetchOne,
  insertOne,
  selectMany,
  transaction,
  updateMany,
} from "./query";
