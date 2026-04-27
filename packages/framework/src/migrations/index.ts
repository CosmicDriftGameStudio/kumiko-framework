export {
  buildProjectionTableIndex,
  type ChangedTable,
  compareSnapshots,
  detectProjectionsToRebuild,
  latestMigrationTag,
  projectionsFromChanges,
} from "./projection-detection";
export { type RebuildMarker, readRebuildMarker, writeRebuildMarker } from "./rebuild-marker";
export {
  type AppliedMigration,
  assertSchemaCurrent,
  type ColumnSpec,
  type DriftReport,
  detectDrift,
  formatDriftReport,
  type Journal,
  type JournalEntry,
  loadAppliedMigrations,
  loadJournal,
  loadLatestSnapshot,
  loadPreviousSnapshot,
  loadSnapshot,
  SchemaDriftError,
  type Snapshot,
  type SnapshotTable,
} from "./schema-drift";
