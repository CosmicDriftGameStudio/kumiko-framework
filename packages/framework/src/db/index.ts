export { applyEntityEvent } from "./apply-entity-event.ts";
export { assertExistsIn } from "./assert-exists-in.ts";
export {
  nullBlindIndexesForSubject,
  recordEventsOwnedExclusivelyByTenant,
  recordRowExistsInTenant,
  recordRowOwningTenantId,
  subjectRowExistsInTenant,
} from "./blind-index-cleanup.ts";
export { collectTableMetas } from "./collect-table-metas.ts";
export { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types.ts";
export { seedConfigValues } from "./config-seed.ts";
export type {
  CreateDbConnectionOptions,
  DbConnection,
  DbConnectionHandle,
  DbConnectionOptions,
  DbRow,
  DbRunner,
  DbTx,
} from "./connection.ts";
export {
  createDbConnection,
  DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX,
  dbConnectionOptionsFromEnv,
  outsideTransactionPoolOptionsFromEnv,
} from "./connection.ts";
export type { CursorQueryOptions, CursorResult, DecodedKeysetCursor } from "./cursor.ts";
export { decodeCursor, decodeKeysetCursor, encodeCursor, encodeKeysetCursor } from "./cursor.ts";
export type { SchemaTable, SelectQuery, TableColumns } from "./dialect.ts";
export {
  bigint,
  bigserial,
  boolean,
  extractTableName,
  index,
  instant,
  instantToDriver,
  integer,
  jsonb,
  moneyAmount,
  numeric,
  primaryKey,
  serial,
  sql,
  table,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./dialect.ts";
export type { EagerLoadEntityResolver, EagerLoadViewer, EagerloadedRow } from "./eagerload.ts";
export {
  collectReferenceFields,
  enrichRowWithReferences,
  enrichWithReferences,
} from "./eagerload.ts";
export {
  collectEncryptedFieldNames,
  configuredEntityFieldEncryption,
  configureEntityFieldEncryption,
  decryptEntityFieldValues,
  encryptEntityFieldValues,
} from "./entity-field-encryption.ts";
export { entityTableFromRegistry } from "./entity-table-from-registry.ts";
export type {
  BuildEntityTableMetaOptions,
  ColumnMeta,
  CompositePrimaryKeyMeta,
  EntityTableMeta,
  IndexMeta,
  PgType,
  UnmanagedTableInput,
} from "./entity-table-meta.ts";
export {
  defineUnmanagedTable,
  deriveEntityTableMeta,
} from "./entity-table-meta.ts";
export type {
  EntityLifecycleVerb,
  EventStoreExecutor,
  EventStoreExecutorOptions,
  LockGuardOption,
  WritePurpose,
} from "./event-store-executor.ts";
export {
  createEventStoreExecutor,
  entityEventName,
  WritePurposes,
} from "./event-store-executor.ts";
export {
  enumerateFeatureTableSources,
  type FeatureTableSource,
} from "./feature-table-sources.ts";
export {
  flattenLocatedTimestamp,
  type LocatedTimestampRead,
  rehydrateLocatedTimestamp,
} from "./located-timestamp.ts";
export {
  assertUniqueTableNames,
  assertValidMigrationName,
  diffSnapshots,
  type GenerateMigrationInput,
  type GenerateMigrationOutput,
  generateMigration,
  loadSnapshotJson,
  renderMigrationSql,
  type SchemaDiff,
  type Snapshot,
  snapshotFromMetas,
  writeSnapshotJson,
} from "./migrate-generator.ts";
export {
  type AppliedMigration,
  type ApplyResult,
  type BaselineResult,
  baselineMigrations,
  fetchAppliedMigrations,
  loadMigrationsFromDir,
  type Migration,
  MigrationChecksumMismatchError,
  readMigrationSqlTexts,
  runMigrations,
  runMigrationsFromDir,
  splitSqlStatements,
} from "./migrate-runner.ts";
export { flattenMoney, type MoneyRead, moneyPayloadToMinorUnits, rehydrateMoney } from "./money.ts";
export {
  constraintOf,
  extractPgError,
  isTableAlreadyExists,
  isUniqueViolation,
  type PgErrorInfo,
} from "./pg-error.ts";
export { acquireNamespacedAdvisoryLock } from "./queries/advisory-lock.ts";
export { toPostgresArrayLiteral } from "./queries/postgres-array-literal.ts";
export { executeRawQuery, executeRawQueryRead } from "./queries/raw-sql.ts";
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
} from "./query.ts";
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
} from "./query.ts";
export {
  readRebuildMarker,
  rebuildTablesFromDiff,
  writeRebuildMarker,
} from "./rebuild-marker.ts";
export { seedReferenceData } from "./reference-data.ts";
export { renderTableDdl, renderTablesDdl } from "./render-ddl.ts";
export {
  diffReplayAgainstSnapshot,
  type ReplayedSchema,
  type ReplayedTable,
  type ReplayMismatch,
  replayMigrationsDir,
} from "./replay-migration-sql.ts";
export {
  findCommentedDropTables,
  isRetiredFrameworkTable,
  type RetiredFrameworkTable,
  retiredFrameworkTables,
} from "./retired-framework-tables.ts";
export { tableExists } from "./schema-inspection.ts";
export {
  buildBaseColumns,
  buildEntityTable,
  declareGlobalTenancy,
  type EntityRow,
  type EntityTable,
  physicalColumnName,
  toSnakeCase,
  toTableName,
} from "./table-builder.ts";
export type {
  CreateTenantDbOptions,
  OutsideTransactionContext,
  TenantDb,
  TenantDbGrants,
  TenantDbMode,
  UncheckedSystemDb,
} from "./tenant-db.ts";
export {
  castTenantRows,
  createSystemDbView,
  createTenantDb,
  hasOutsideTransactionDb,
  requireOutsideTransactionDb,
  runInOwnTransaction,
  SYSTEM_SCOPE_CHECK_BRAND,
  scopeTenantDbToTenant,
} from "./tenant-db.ts";
