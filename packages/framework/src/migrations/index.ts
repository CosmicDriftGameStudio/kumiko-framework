// Drizzle-free gate (kumiko/migrations system) — the canonical boot-gate.
export {
  assertKumikoSchemaCurrent,
  type ChecksumMismatch,
  detectKumikoDrift,
  formatKumikoDriftReport,
  type KumikoDriftReport,
  SchemaDriftError,
} from "./kumiko-drift.ts";
// Persistente Pending-Rebuild-Queue (survives Rebuild-Failures + Crashes).
export {
  createPendingRebuildsTable,
  type EnqueueProjectionRebuildDeps,
  type EnqueueProjectionRebuildResult,
  enqueueProjectionRebuild,
  listPendingRebuilds,
  type PendingRebuildRun,
  PROJECTION_REBUILD_JOB,
  pendingRebuildsTable,
  queueRebuildsFromMarkers,
  type RunPendingRebuildsOptions,
  rebuildProjectionOrMultiStream,
  reportPendingRebuildRun,
  runPendingRebuilds,
} from "./pending-rebuilds.ts";
// Boot-time backfill: re-encrypts plaintext events after a PII annotation was added.
export {
  createPiiBackfillStateTable,
  type PiiEventBackfillOptions,
  type PiiEventBackfillResult,
  type PiiRebuildRun,
  piiAnnotationFingerprint,
  piiBackfillStateTable,
  runPiiEventBackfill,
} from "./pii-event-backfill.ts";
// tableName → projection-name, for application-side projection rebuilds.
export { buildProjectionTableIndex } from "./projection-table-index.ts";
