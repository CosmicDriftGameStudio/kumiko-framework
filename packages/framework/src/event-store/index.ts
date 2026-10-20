export { APP_INSTANCE_STREAM_TYPE, APP_STARTED_EVENT_TYPE } from "../crypto/system-event-pii.ts";
export {
  backfillEventPiiEncryption,
  backfillEventPiiEncryptionBatch,
  type PiiBackfillBatchOptions,
  type PiiBackfillBatchResult,
  type PiiBackfillFailure,
  type PiiBackfillOptions,
  type PiiBackfillResult,
  type PiiBackfillScanCache,
} from "../db/queries/backfill-pii.ts";
export {
  type ArchiveStreamArgs,
  archivedStreamsTable,
  archiveStream,
  createArchivedStreamsTable,
  isStreamArchived,
  restoreStream,
} from "./archive.ts";
export {
  type DeleteRowsWithoutReplayableStreamArgs,
  deleteRowsWithoutReplayableStream,
} from "./delete-rows-without-replayable-stream.ts";
export {
  ArchivedStreamError,
  IdempotentAppendConflictError,
  SeedTimeOrderError,
  VersionConflictError,
} from "./errors.ts";
export {
  append,
  EVENTS_PUBSUB_CHANNEL,
  type EventMetadata,
  type EventToAppend,
  getEventsHighWaterMark,
  getStreamVersion,
  getStreamVersions,
  getUnscopedAggregateStreamMaxVersion,
  getUnscopedStreamMaxVersionForSeed,
  LOAD_ALL_EVENTS_ROW_LIMIT,
  loadAggregate,
  loadAggregateAsOf,
  loadAllEventsByType,
  loadEventsAfterVersion,
  type StoredEvent,
  streamAllEventsByType,
} from "./event-store.ts";
export { createEventsTable, eventsTable } from "./events-schema.ts";
export { appendProvenanceEvent, type ProvenanceEventInput } from "./provenance-append.ts";
export {
  createRebuildDeadLetterTable,
  listRebuildDeadLetters,
  type RebuildDeadLetterRow,
  rebuildDeadLetterTable,
  recordRebuildDeadLetters,
  type SkippedApply,
} from "./rebuild-dead-letter.ts";
export { toStoredEvent } from "./row-to-stored-event.ts";
export {
  assertSeedModeNotInProduction,
  isSeedModeEnabled,
  runSeedWritesAt,
  SEED_MODE_ENV,
  SeedModeDisabledError,
} from "./seed-clock.ts";
export {
  createSnapshotsTable,
  type LoadAggregateWithSnapshotOptions,
  type LoadAggregateWithSnapshotResult,
  loadAggregateWithSnapshot,
  loadLatestSnapshot,
  type SaveSnapshotArgs,
  type Snapshot,
  type SnapshotReducer,
  saveSnapshot,
  snapshotsTable,
} from "./snapshot.ts";
export {
  type AppendEventInTenantDbOptions,
  appendEventInTenantDb,
  getStreamVersionInTenantDb,
} from "./tenant-db-append.ts";
export {
  AGGREGATE_TRANSFER_STREAM_TYPE,
  AGGREGATE_TRANSFERRED_EVENT_TYPE,
  type TransferAggregateStreamsArgs,
  transferAggregateStreams,
} from "./transfer.ts";
export {
  type EventUpcasters,
  makeUpcastCtx,
  type UpcasterErrorPolicy,
  type UpcastOptions,
  upcastStoredEvent,
  upcastStoredEvents,
} from "./upcaster.ts";
export {
  createUpcasterDeadLetterTable,
  type DeadLetterRow,
  listDeadLetters,
  recordUpcasterDeadLetter,
  upcasterDeadLetterTable,
} from "./upcaster-dead-letter.ts";
