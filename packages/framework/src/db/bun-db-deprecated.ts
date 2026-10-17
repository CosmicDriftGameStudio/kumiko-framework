/**
 * @deprecated Moved to `@cosmicdrift/kumiko-framework/db`. Run `bun kumiko-upgrade --apply`
 * to rewrite imports. Removed in the first release after 2026-10-29.
 */
export type {
  DeleteManyBatchedOptions,
  DeleteManyBatchedResult,
  IncrementCounterOptions,
  InnerJoinRow,
  InnerJoinSpec,
  InsertOnConflictDoNothingOptions,
  JoinColumnPair,
  JsonTextMatch,
  SelectOptions,
  TableInfo,
  UpsertOnConflictOptions,
  WhereObject,
  WhereOperator,
  WhereValue,
} from "./query.js";
/**
 * @deprecated Moved to `@cosmicdrift/kumiko-framework/db`. Run `bun kumiko-upgrade --apply`
 * to rewrite imports. Removed in the first release after 2026-10-29.
 */
export {
  aggregateWhere,
  asEntityTableMeta,
  asRawClient,
  countWhere,
  deleteMany,
  deleteManyBatched,
  extractTableInfo,
  fetchOne,
  incrementCounter,
  insertMany,
  insertOnConflictDoNothing,
  insertOne,
  instantToTimestamptzParam,
  isTimestamptzType,
  requireEntityTableMeta,
  runInSavepoint,
  runInSavepointIfSupported,
  runnerCanBeginTransaction,
  selectInnerJoin,
  selectMany,
  transaction,
  unsafeReadRetrying,
  updateMany,
  upsertByPk,
  upsertOnConflict,
} from "./query.js";
