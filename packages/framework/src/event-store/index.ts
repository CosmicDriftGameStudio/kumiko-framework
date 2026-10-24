export { APP_INSTANCE_STREAM_TYPE, APP_STARTED_EVENT_TYPE } from "../crypto/system-event-pii.ts";
export {
  backfillEventPiiEncryption,
  backfillEventPiiEncryptionBatch,
} from "../db/queries/backfill-pii.ts";
export { deleteRowsWithoutReplayableStream } from "../db/queries/event-store-orphan-rows.ts";
export {
  archivedStreamsTable,
  archiveStream,
  createArchivedStreamsTable,
  isStreamArchived,
} from "./archive.ts";
export {
  SeedTimeOrderError,
  VersionConflictError,
} from "./errors.ts";
export {
  append,
  type EventMetadata,
  getEventsHighWaterMark,
  getStreamVersion,
  getStreamVersions,
  getUnscopedAggregateStreamMaxVersion,
  getUnscopedStreamMaxVersionForSeed,
  loadAggregate,
  type StoredEvent,
  streamAllEventsByType,
} from "./event-store.ts";
export { createEventsTable, eventsTable } from "./events-schema.ts";
export { appendProvenanceEvent } from "./provenance-append.ts";
export {
  assertSeedModeNotInProduction,
  isSeedModeEnabled,
  runSeedWritesAt,
  SEED_MODE_ENV,
  SeedModeDisabledError,
} from "./seed-clock.ts";
export { snapshotsTable } from "./snapshot.ts";
export {
  appendEventInTenantDb,
  getStreamVersionInTenantDb,
} from "./tenant-db-append.ts";
export {
  AGGREGATE_TRANSFER_STREAM_TYPE,
  AGGREGATE_TRANSFERRED_EVENT_TYPE,
  transferAggregateStreams,
} from "./transfer.ts";
export {
  makeUpcastCtx,
  upcastStoredEvent,
} from "./upcaster.ts";
export { upcasterDeadLetterTable } from "./upcaster-dead-letter.ts";
