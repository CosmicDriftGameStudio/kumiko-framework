// Drizzle-free gate (kumiko/migrations system) — the canonical boot-gate.
export {
  assertKumikoSchemaCurrent,
  type ChecksumMismatch,
  detectKumikoDrift,
  formatKumikoDriftReport,
  type KumikoDriftReport,
  SchemaDriftError,
} from "./kumiko-drift";
// Persistente Pending-Rebuild-Queue (survives Rebuild-Failures + Crashes).
export {
  createPendingRebuildsTable,
  listPendingRebuilds,
  type PendingRebuildRun,
  pendingRebuildsTable,
  queueRebuildsFromMarkers,
  type RunPendingRebuildsOptions,
  runPendingRebuilds,
} from "./pending-rebuilds";
// tableName → projection-name, für den app-seitigen Projection-Rebuild.
export { buildProjectionTableIndex } from "./projection-table-index";
