export type { EscapeHatchReportWindow } from "../observability/escape-hatch-report.ts";
export {
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  ESCAPE_HATCH_USED_SIGNAL,
  fallbackEscapeHatchReporter,
  flushEscapeHatchAudits,
  reportEscapeHatchUse,
  UNATTRIBUTED_ACTOR,
  withEscapeHatchAuditScope,
} from "../observability/escape-hatch-report.ts";
export { normalizePayloadBucketValue } from "../rate-limit/bucket.ts";
export { createUnlimitedRateLimitResolver } from "../rate-limit/unlimited-resolver.ts";
export type { AppendDomainEventCoreDeps } from "./append-event-core.ts";
export { appendDomainEventCore } from "./append-event-core.ts";
export type { ResolveAuthClaimsArgs } from "./auth-claims-resolver.ts";
export { resolveAuthClaims } from "./auth-claims-resolver.ts";
export { createCascadeDeleteHook } from "./cascade-handler.ts";
export type { Dispatcher } from "./dispatcher.ts";
export { createDispatcher, dispatcherToWriteRef } from "./dispatcher.ts";
export type { FailedWriteResult } from "./dispatcher-utils.ts";
export { isFailedWriteResult } from "./dispatcher-utils.ts";
export type { DistributedLock } from "./distributed-lock.ts";
export { createDistributedLock } from "./distributed-lock.ts";
export type { EntityCache, EntityCacheOptions } from "./entity-cache.ts";
export { createEntityCache } from "./entity-cache.ts";
export type { ConsumerStatus, PendingGapEntry } from "./event-consumer-state.ts";
export {
  ConsumerStatuses,
  createEventConsumerStateTable,
  eventConsumerStateTable,
  SHARED_INSTANCE_SENTINEL,
} from "./event-consumer-state.ts";
export type { EventDedup } from "./event-dedup.ts";
export { createEventDedup } from "./event-dedup.ts";
export type {
  ConsumerProgress,
  ConsumerRecoveryState,
  ConsumerTransitionRejection,
  DispatcherPassResult,
  EventConsumer,
  EventConsumerBatchHandler,
  EventConsumerHandler,
  EventDispatcher,
  EventDispatcherOptions,
} from "./event-dispatcher.ts";
export {
  ConsumerTransitionError,
  createEventDispatcher,
  disableConsumer,
  enableConsumer,
  getAllConsumerProgress,
  getConsumerState,
  listConsumersWithState,
  restartConsumer,
  skipPoisonEvent,
} from "./event-dispatcher.ts";
export type { ConsumerCursor } from "./event-dispatcher-delivery.ts";
export { selectConsumerCursorForUpdate } from "./event-dispatcher-delivery.ts";
export type { PruneEventsOptions, PruneEventsResult } from "./event-retention.ts";
export { ConsumerLagError, pruneEvents } from "./event-retention.ts";
export type { IdempotencyGuard } from "./idempotency.ts";
export { createIdempotencyGuard } from "./idempotency.ts";
export {
  assertInstructionFieldWriteAllowed,
  assertIrreversibleOperationAllowed,
  isIrreversibleEntityVerb,
} from "./irreversible-operation-gate.ts";
export type { LifecycleHooks, SystemHookDef, SystemHooks } from "./lifecycle-pipeline.ts";
export { createLifecycleHooks } from "./lifecycle-pipeline.ts";
export type { MspRebuildDeps } from "./msp-rebuild.ts";
export { rebuildMultiStreamProjection } from "./msp-rebuild.ts";
export type {
  MultiStreamApplyContext,
  MultiStreamApplyContextDeps,
} from "./multi-stream-apply-context.ts";
export { createMultiStreamApplyContext } from "./multi-stream-apply-context.ts";
export { assertNotifyTargetsOwnTenant, createDeferringNotify } from "./notify-scope.ts";
export type { ProjectionProgress, RebuildResult } from "./projection-rebuild.ts";
export {
  getAllProjectionProgress,
  getProjectionState,
  listProjectionsWithState,
  rebuildProjection,
} from "./projection-rebuild.ts";
export type { ProjectionStatus } from "./projection-state.ts";
export {
  createProjectionStateTable,
  ProjectionStatuses,
  projectionStateTable,
} from "./projection-state.ts";
export { runProjectionsForEvent } from "./projections-runner.ts";
export {
  ACCESS_INVALIDATION_CONSUMER_NAME,
  createAccessInvalidationEventConsumer,
  createSearchEventConsumer,
  createSseBroadcastEventConsumer,
  SEARCH_CONSUMER_NAME,
  SSE_BROADCAST_CONSUMER_NAME,
} from "./system-hooks.ts";
export { TENANT_TIMEZONE_CONFIG_KEY } from "./tenant-timezone-config-key.ts";
