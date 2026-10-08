export type { EscapeHatchReportWindow } from "../observability/escape-hatch-report.js";
export {
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  ESCAPE_HATCH_USED_SIGNAL,
  fallbackEscapeHatchReporter,
  reportEscapeHatchUse,
  UNATTRIBUTED_ACTOR,
} from "../observability/escape-hatch-report.js";
export type { AppendDomainEventCoreDeps } from "./append-event-core.js";
export { appendDomainEventCore } from "./append-event-core.js";
export type { ResolveAuthClaimsArgs } from "./auth-claims-resolver.js";
export { resolveAuthClaims } from "./auth-claims-resolver.js";
export { createCascadeDeleteHook } from "./cascade-handler.js";
export type { Dispatcher } from "./dispatcher.js";
export { createDispatcher, dispatcherToWriteRef } from "./dispatcher.js";
export type { FailedWriteResult } from "./dispatcher-utils.js";
export { isFailedWriteResult } from "./dispatcher-utils.js";
export type { DistributedLock } from "./distributed-lock.js";
export { createDistributedLock } from "./distributed-lock.js";
export type { EntityCache, EntityCacheOptions } from "./entity-cache.js";
export { createEntityCache } from "./entity-cache.js";
export type { ConsumerStatus, PendingGapEntry } from "./event-consumer-state.js";
export {
  ConsumerStatuses,
  createEventConsumerStateTable,
  eventConsumerStateTable,
  SHARED_INSTANCE_SENTINEL,
} from "./event-consumer-state.js";
export type { EventDedup } from "./event-dedup.js";
export { createEventDedup } from "./event-dedup.js";
export type {
  ConsumerProgress,
  ConsumerRecoveryState,
  DispatcherPassResult,
  EventConsumer,
  EventConsumerBatchHandler,
  EventConsumerHandler,
  EventDispatcher,
  EventDispatcherOptions,
} from "./event-dispatcher.js";
export {
  createEventDispatcher,
  disableConsumer,
  enableConsumer,
  getAllConsumerProgress,
  getConsumerState,
  listConsumersWithState,
  restartConsumer,
  skipPoisonEvent,
} from "./event-dispatcher.js";
export type { ConsumerCursor } from "./event-dispatcher-delivery.js";
export { selectConsumerCursorForUpdate } from "./event-dispatcher-delivery.js";
export type { PruneEventsOptions, PruneEventsResult } from "./event-retention.js";
export { ConsumerLagError, pruneEvents } from "./event-retention.js";
export type { IdempotencyGuard } from "./idempotency.js";
export { createIdempotencyGuard } from "./idempotency.js";
export {
  assertInstructionFieldWriteAllowed,
  assertIrreversibleOperationAllowed,
  isIrreversibleEntityVerb,
} from "./irreversible-operation-gate.js";
export type { LifecycleHooks, SystemHookDef, SystemHooks } from "./lifecycle-pipeline.js";
export { createLifecycleHooks } from "./lifecycle-pipeline.js";
export type { MspRebuildDeps } from "./msp-rebuild.js";
export { rebuildMultiStreamProjection } from "./msp-rebuild.js";
export type { ProjectionProgress, RebuildResult } from "./projection-rebuild.js";
export {
  getAllProjectionProgress,
  getProjectionState,
  listProjectionsWithState,
  rebuildProjection,
} from "./projection-rebuild.js";
export type { ProjectionStatus } from "./projection-state.js";
export {
  createProjectionStateTable,
  ProjectionStatuses,
  projectionStateTable,
} from "./projection-state.js";
export { runProjectionsForEvent } from "./projections-runner.js";
export {
  ACCESS_INVALIDATION_CONSUMER_NAME,
  createAccessInvalidationEventConsumer,
  createSearchEventConsumer,
  createSseBroadcastEventConsumer,
  SEARCH_CONSUMER_NAME,
  SSE_BROADCAST_CONSUMER_NAME,
} from "./system-hooks.js";
