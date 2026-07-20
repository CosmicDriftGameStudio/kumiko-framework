export {
  backfillEventPiiEncryption,
  type PiiBackfillFailure,
  type PiiBackfillOptions,
  type PiiBackfillResult,
} from "../db/queries/backfill-pii";
export {
  type ArchiveStreamArgs,
  archivedStreamsTable,
  archiveStream,
  createArchivedStreamsTable,
  isStreamArchived,
  restoreStream,
} from "./archive";
export { ArchivedStreamError, VersionConflictError } from "./errors";
export {
  append,
  EVENTS_PUBSUB_CHANNEL,
  type EventMetadata,
  type EventToAppend,
  getAggregateStreamMaxVersion,
  getAggregateStreamTenant,
  getEventsHighWaterMark,
  getStreamVersion,
  LOAD_ALL_EVENTS_ROW_LIMIT,
  loadAggregate,
  loadAggregateAsOf,
  loadAllEventsByType,
  loadEventsAfterVersion,
  type StoredEvent,
  streamAllEventsByType,
} from "./event-store";
export { createEventsTable, eventsTable } from "./events-schema";
export {
  createRebuildDeadLetterTable,
  listRebuildDeadLetters,
  type RebuildDeadLetterRow,
  rebuildDeadLetterTable,
  recordRebuildDeadLetters,
  type SkippedApply,
} from "./rebuild-dead-letter";
export { toStoredEvent } from "./row-to-stored-event";
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
} from "./snapshot";
export {
  type EventUpcasters,
  makeUpcastCtx,
  type UpcasterErrorPolicy,
  type UpcastOptions,
  upcastStoredEvent,
  upcastStoredEvents,
} from "./upcaster";
export {
  createUpcasterDeadLetterTable,
  type DeadLetterRow,
  listDeadLetters,
  recordUpcasterDeadLetter,
  upcasterDeadLetterTable,
} from "./upcaster-dead-letter";
