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
  getEventsHighWaterMark,
  getStreamVersion,
  loadAggregate,
  loadAggregateAsOf,
  loadAllEventsByType,
  loadEventsAfterVersion,
  type StoredEvent,
  streamAllEventsByType,
} from "./event-store";
export { createEventsTable, eventsTable } from "./events-schema";
export {
  createSnapshotsTable,
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
