// Drizzle-free gate (kumiko/migrations system) — the canonical boot-gate.

// Erases chosen payload fields of stored events and rebuilds the projections fed by them.
export {
  type EventScrubCandidate,
  type ScrubEventPayloadOptions,
  type ScrubEventPayloadResult,
  scrubEventPayloadFields,
} from "./event-payload-scrub.ts";
export {
  assertKumikoSchemaCurrent,
  SchemaDriftError,
} from "./kumiko-drift.ts";
// Persistente Pending-Rebuild-Queue (survives Rebuild-Failures + Crashes).
export {
  enqueueProjectionRebuild,
  listPendingRebuilds,
  PROJECTION_REBUILD_JOB,
  queueRebuildsFromMarkers,
  rebuildProjectionOrMultiStream,
  reportPendingRebuildRun,
  runPendingRebuilds,
} from "./pending-rebuilds.ts";
// Boot-time backfill: re-encrypts plaintext events after a PII annotation was added.
export { runPiiEventBackfill } from "./pii-event-backfill.ts";
// tableName → projection-name, for application-side projection rebuilds.
export { buildProjectionTableIndex } from "./projection-table-index.ts";
