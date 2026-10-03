// bun-db: Bun.sql-basierte DB-API ohne drizzle.
// Production-Pfad nach drizzle-removal.

export type {
  BunDbConnection,
  BunDbConnectionOptions,
  BunDbRunner,
  BunDbTx,
  PgListenClient,
} from "./connection.js";
export { bunDbConnectionOptionsFromEnv, createBunDbConnection } from "./connection.js";
export type {
  InnerJoinRow,
  InnerJoinSpec,
  InsertOnConflictDoNothingOptions,
  JoinColumnPair,
  JsonTextMatch,
  SelectOptions,
  TableInfo,
  WhereObject,
  WhereOperator,
  WhereValue,
} from "./query.js";
export {
  aggregateWhere,
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
  insertOnConflictDoNothing,
  insertOne,
  isTimestamptzType,
  requireEntityTableMeta,
  runInSavepoint,
  runInSavepointIfSupported,
  selectInnerJoin,
  selectMany,
  transaction,
  type UpsertOnConflictOptions,
  unsafeReadRetrying,
  updateMany,
  upsertByPk,
  upsertOnConflict,
} from "./query.js";
