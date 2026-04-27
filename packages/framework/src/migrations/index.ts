export {
  buildProjectionTableIndex,
  type ChangedTable,
  type ColumnSpec,
  compareSnapshots,
  detectProjectionsToRebuild,
  type DetailedSnapshot,
  latestMigrationTag,
  loadCurrentSnapshot,
  loadDetailedSnapshot,
  loadPreviousSnapshot,
  projectionsFromChanges,
} from "./projection-detection";
export { readRebuildMarker, type RebuildMarker, writeRebuildMarker } from "./rebuild-marker";
export {
  type AppliedMigration,
  assertSchemaCurrent,
  detectDrift,
  type DriftReport,
  type DrizzleSnapshot,
  formatDriftReport,
  type Journal,
  type JournalEntry,
  loadAppliedMigrations,
  loadJournal,
  loadLatestSnapshot,
  SchemaDriftError,
} from "./schema-drift";
