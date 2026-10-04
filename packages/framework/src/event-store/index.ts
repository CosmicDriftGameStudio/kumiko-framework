export { APP_INSTANCE_STREAM_TYPE, APP_STARTED_EVENT_TYPE } from "../crypto/system-event-pii.js";
export {
  backfillEventPiiEncryption,
  backfillEventPiiEncryptionBatch,
  type PiiBackfillBatchOptions,
  type PiiBackfillBatchResult,
  type PiiBackfillFailure,
  type PiiBackfillOptions,
  type PiiBackfillResult,
  type PiiBackfillScanCache,
} from "../db/queries/backfill-pii.js";
export {
  type ArchiveStreamArgs,
  archivedStreamsTable,
  archiveStream,
  createArchivedStreamsTable,
  isStreamArchived,
  restoreStream,
} from "./archive.js";
export {
  ArchivedStreamError,
  IdempotentAppendConflictError,
  VersionConflictError,
} from "./errors.js";
export {
  append,
  EVENTS_PUBSUB_CHANNEL,
  type EventMetadata,
  type EventToAppend,
  getEventsHighWaterMark,
  getStreamVersion,
  getUnscopedAggregateStreamMaxVersion,
  getUnscopedStreamMaxVersionForSeed,
  LOAD_ALL_EVENTS_ROW_LIMIT,
  loadAggregate,
  loadAggregateAsOf,
  loadAllEventsByType,
  loadEventsAfterVersion,
  type StoredEvent,
  streamAllEventsByType,
} from "./event-store.js";
export { createEventsTable, eventsTable } from "./events-schema.js";
export { appendProvenanceEvent, type ProvenanceEventInput } from "./provenance-append.js";
export {
  createRebuildDeadLetterTable,
  listRebuildDeadLetters,
  type RebuildDeadLetterRow,
  rebuildDeadLetterTable,
  recordRebuildDeadLetters,
  type SkippedApply,
} from "./rebuild-dead-letter.js";
export { toStoredEvent } from "./row-to-stored-event.js";
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
} from "./snapshot.js";
export {
  AGGREGATE_TRANSFER_STREAM_TYPE,
  AGGREGATE_TRANSFERRED_EVENT_TYPE,
  type TransferAggregateStreamsArgs,
  transferAggregateStreams,
} from "./transfer.js";
export {
  type EventUpcasters,
  makeUpcastCtx,
  type UpcasterErrorPolicy,
  type UpcastOptions,
  upcastStoredEvent,
  upcastStoredEvents,
} from "./upcaster.js";
export {
  createUpcasterDeadLetterTable,
  type DeadLetterRow,
  listDeadLetters,
  recordUpcasterDeadLetter,
  upcasterDeadLetterTable,
} from "./upcaster-dead-letter.js";
