export { assertExistsIn } from "./assert-exists-in";
export { collectTableMetas } from "./collect-table-metas";
export { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types";
export { seedConfigValues } from "./config-seed";
export type { DbConnection, DbConnectionOptions, DbRow, DbRunner, DbTx } from "./connection";
export { createDbConnection, dbConnectionOptionsFromEnv } from "./connection";
export type { CursorQueryOptions, CursorResult } from "./cursor";
export { decodeCursor, encodeCursor } from "./cursor";
export type { SchemaTable, SelectQuery, TableColumns } from "./dialect";
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
} from "./dialect";
export type { EagerLoadEntityResolver, EagerloadedRow } from "./eagerload";
export {
  collectReferenceFields,
  enrichRowWithReferences,
  enrichWithReferences,
} from "./eagerload";
export type { EncryptionProvider } from "./encryption";
export { createEncryptionProvider } from "./encryption";
export {
  collectEncryptedFieldNames,
  decryptEntityFieldValues,
  encryptEntityFieldValues,
} from "./entity-field-encryption";
export type {
  BuildEntityTableMetaOptions,
  ColumnMeta,
  CompositePrimaryKeyMeta,
  EntityTableMeta,
  IndexMeta,
  PgType,
  UnmanagedTableInput,
} from "./entity-table-meta";
export { buildEntityTableMeta, defineUnmanagedTable } from "./entity-table-meta";
export type {
  EntityLifecycleVerb,
  EventStoreExecutor,
  EventStoreExecutorOptions,
} from "./event-store-executor";
export { createEventStoreExecutor, entityEventName } from "./event-store-executor";
export {
  enumerateFeatureTableSources,
  type FeatureTableSource,
} from "./feature-table-sources";
export { flattenLocatedTimestamp, rehydrateLocatedTimestamp } from "./located-timestamp";
export {
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
} from "./migrate-generator";
export {
  type AppliedMigration,
  type ApplyResult,
  type BaselineResult,
  baselineMigrations,
  fetchAppliedMigrations,
  loadMigrationsFromDir,
  type Migration,
  MigrationChecksumMismatchError,
  runMigrations,
  runMigrationsFromDir,
  splitSqlStatements,
} from "./migrate-runner";
export { flattenMoney, rehydrateMoney } from "./money";
export {
  constraintOf,
  extractPgError,
  isTableAlreadyExists,
  isUniqueViolation,
  type PgErrorInfo,
} from "./pg-error";
export type { SelectOptions, WhereObject, WhereValue } from "./query-api";
export {
  asRawClient,
  countWhere,
  deleteMany,
  fetchOne,
  insertMany,
  insertOne,
  selectMany,
  transaction,
  updateMany,
} from "./query-api";
export {
  readRebuildMarker,
  rebuildTablesFromDiff,
  writeRebuildMarker,
} from "./rebuild-marker";
export { seedReferenceData } from "./reference-data";
export { renderTableDdl, renderTablesDdl } from "./render-ddl";
export { tableExists } from "./schema-inspection";
export {
  buildBaseColumns,
  buildEntityTable,
  type EntityTable,
  toSnakeCase,
  toTableName,
} from "./table-builder";
export type { TenantDb, TenantDbMode } from "./tenant-db";
export { castTenantRows, createTenantDb } from "./tenant-db";
