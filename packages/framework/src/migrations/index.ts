// Drizzle-free gate (kumiko/migrations system) — the canonical boot-gate.
// `SchemaDriftError` is re-exported from here; the legacy drizzle gate above
// keeps its own internal error until Phase 3 removes schema-drift.ts.
export {
  assertKumikoSchemaCurrent,
  type ChecksumMismatch,
  detectKumikoDrift,
  formatKumikoDriftReport,
  type KumikoDriftReport,
  SchemaDriftError,
} from "./kumiko-drift";
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
  type ColumnIssue,
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
  type Snapshot,
  type SnapshotTable,
} from "./schema-drift";
