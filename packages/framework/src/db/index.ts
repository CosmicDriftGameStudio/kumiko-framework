export { assertExistsIn } from "./assert-exists-in.js";
export {
  nullBlindIndexesForSubject,
  recordEventsOwnedExclusivelyByTenant,
  recordRowExistsInTenant,
  recordRowOwningTenantId,
  subjectRowExistsInTenant,
} from "./blind-index-cleanup.js";
export { collectTableMetas } from "./collect-table-metas.js";
export { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types.js";
export { seedConfigValues } from "./config-seed.js";
export type {
  DbConnection,
  DbConnectionOptions,
  DbPoolHandle,
  DbRow,
  DbRunner,
  DbTx,
} from "./connection.js";
export { createDbConnection, dbConnectionOptionsFromEnv } from "./connection.js";
export type { CursorQueryOptions, CursorResult, DecodedKeysetCursor } from "./cursor.js";
export { decodeCursor, decodeKeysetCursor, encodeCursor, encodeKeysetCursor } from "./cursor.js";
export type { SchemaTable, SelectQuery, TableColumns } from "./dialect.js";
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
} from "./dialect.js";
export type { EagerLoadEntityResolver, EagerloadedRow } from "./eagerload.js";
export {
  collectReferenceFields,
  enrichRowWithReferences,
  enrichWithReferences,
} from "./eagerload.js";
export {
  collectEncryptedFieldNames,
  configuredEntityFieldEncryption,
  configureEntityFieldEncryption,
  decryptEntityFieldValues,
  encryptEntityFieldValues,
} from "./entity-field-encryption.js";
export { entityTableFromRegistry } from "./entity-table-from-registry.js";
export type {
  BuildEntityTableMetaOptions,
  ColumnMeta,
  CompositePrimaryKeyMeta,
  EntityTableMeta,
  IndexMeta,
  PgType,
  UnmanagedTableInput,
} from "./entity-table-meta.js";
export {
  buildEntityTableMeta,
  defineUnmanagedTable,
  deriveEntityTableMeta,
} from "./entity-table-meta.js";
export type {
  EntityLifecycleVerb,
  EventStoreExecutor,
  EventStoreExecutorOptions,
} from "./event-store-executor.js";
export { createEventStoreExecutor, entityEventName } from "./event-store-executor.js";
export {
  enumerateFeatureTableSources,
  type FeatureTableSource,
} from "./feature-table-sources.js";
export { flattenLocatedTimestamp, rehydrateLocatedTimestamp } from "./located-timestamp.js";
export {
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
} from "./migrate-generator.js";
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
} from "./migrate-runner.js";
export { flattenMoney, type MoneyRead, moneyPayloadToMinorUnits, rehydrateMoney } from "./money.js";
export {
  constraintOf,
  extractPgError,
  isTableAlreadyExists,
  isUniqueViolation,
  type PgErrorInfo,
} from "./pg-error.js";
export { acquireNamespacedAdvisoryLock } from "./queries/advisory-lock.js";
export { executeRawQuery, executeRawQueryRead } from "./queries/raw-sql.js";
export type { SelectOptions, WhereObject, WhereValue } from "./query-api.js";
export {
  aggregateWhere,
  asRawClient,
  countWhere,
  deleteMany,
  fetchOne,
  insertMany,
  insertOne,
  runInSavepoint,
  selectMany,
  transaction,
  updateMany,
} from "./query-api.js";
export {
  readRebuildMarker,
  rebuildTablesFromDiff,
  writeRebuildMarker,
} from "./rebuild-marker.js";
export { seedReferenceData } from "./reference-data.js";
export { renderTableDdl, renderTablesDdl } from "./render-ddl.js";
export {
  diffReplayAgainstSnapshot,
  type ReplayedSchema,
  type ReplayedTable,
  type ReplayMismatch,
  replayMigrationsDir,
} from "./replay-migration-sql.js";
export {
  findCommentedDropTables,
  isRetiredFrameworkTable,
  type RetiredFrameworkTable,
  retiredFrameworkTables,
} from "./retired-framework-tables.js";
export { tableExists } from "./schema-inspection.js";
export {
  buildBaseColumns,
  buildEntityTable,
  declareGlobalTenancy,
  type EntityTable,
  physicalColumnName,
  toSnakeCase,
  toTableName,
} from "./table-builder.js";
export type { TenantDb, TenantDbGrants, TenantDbMode, UncheckedSystemDb } from "./tenant-db.js";
export {
  castTenantRows,
  createSystemDbView,
  createTenantDb,
  runInOwnTransaction,
  SYSTEM_SCOPE_CHECK_BRAND,
} from "./tenant-db.js";
