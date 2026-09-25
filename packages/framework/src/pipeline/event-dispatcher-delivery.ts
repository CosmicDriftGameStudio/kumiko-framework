// Value-only import, aliased to avoid shadowing the ambient global
// `Temporal` TYPE that ConsumerStateRow.updatedAt/StoredEventRow.createdAt
// resolve against (same #1438 dual-package-hazard pattern as event-store.ts).
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { type RequestContextData, requestContext } from "../api/request-context";
import type { DbConnection, DbRunner, DbTx } from "../db/connection";
import {
  insertConsumerIfAbsent,
  markConsumerProcessing,
  rearmDeadConsumer,
  recordConsumerPassFailure,
  selectConsumerForUpdate,
  selectConsumerForUpdateSkipLocked,
  selectProvablyIdleConsumerPairs,
  updateConsumerDeliveryOutcome,
} from "../db/queries/event-consumer";
import {
  type PendingIdRange,
  selectEventsHeadId,
  selectPendingAndNewEventRows,
} from "../db/queries/event-store";
import { coerceRow, extractTableInfo } from "../db/query";
import { qnScope } from "../engine/qualified-name";
import type { AppContext } from "../engine/types";
import { eventsTable, toStoredEvent as rowToStoredEvent, type StoredEvent } from "../event-store";
import {
  emitDispatcherError,
  emitEventConsumerLag,
  getFallbackMeter,
  type Meter,
} from "../observability";
import {
  ConsumerStatuses,
  eventConsumerStateTable,
  type PendingGapEntry,
  SHARED_INSTANCE_SENTINEL,
} from "./event-consumer-state";
import type { EventConsumer } from "./event-dispatcher";
import { parseWriteOrigin } from "./write-origin";

// Fails closed without throwing: a throw would poison the event for every consumer.
const UNPARSEABLE_STORED_WRITE_ORIGIN = {
  rootHandler: "<unknown>",
  anonymousRoot: true,
  publicIntake: false,
} as const;

// Per-consumer pass mechanics: acquire the state row, fetch pending events,
// hand them to the consumer's handler in order, persist the outcome. Split
// out of event-dispatcher.ts so the delivery loop is independently readable
// from the public lifecycle surface (start/stop/runOnce) and the ops
// recovery surface (event-dispatcher-admin.ts).
//
// Free functions (not closures) — every helper takes an explicit `tx`, none
// use the outer dispatcher's closure state.

export type ConsumerStateRowShape = {
  readonly name: string;
  readonly instanceId: string;
  readonly lastProcessedEventId: bigint;
  readonly status: string;
  readonly attempts: number;
  readonly rearmCount: number;
  readonly pendingGaps: readonly PendingGapEntry[];
  readonly lastError: string | null;
  readonly updatedAt: Temporal.Instant;
};
export type ConsumerStateRow = ConsumerStateRowShape;

export type StoredEventRow = {
  readonly id: bigint;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: string;
  readonly version: number;
  readonly type: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: import("../event-store/event-store").EventMetadata;
  readonly createdAt: Temporal.Instant;
  readonly createdBy: string;
};

export type AcquireOutcome =
  | { readonly state: ConsumerStateRow; readonly skip: null }
  | {
      readonly state: null;
      readonly skip: "locked_by_other_instance" | "disabled" | "dead" | "not_registered";
    };

// Lock the consumer's state row with SKIP LOCKED. Strict: no in-tx bootstrap.
// The row must exist — start() pre-registers every consumer up front so
// prune (event-retention) sees their cursors as soon as the process is up,
// closing the race where a lazy-bootstrapped consumer's cursor is absent
// during prune and its events are silently deleted.
//
// skip="not_registered" signals a row-missing-despite-start condition.
// Production shouldn't hit this — it means either start() wasn't called
// (runOnce() guards against that) or the state row was deleted externally
// (a test TRUNCATE without subsequent ensureRegistered(), or an operator
// intervention). Skipping quietly preserves the dispatcher's other
// consumers and surfaces the issue via the metrics pass-outcome.
export async function acquireConsumerState(
  tx: DbTx,
  name: string,
  instanceId: string,
  rearmCooldownMs: number,
  maxRearmCount: number,
): Promise<AcquireOutcome> {
  const rawState = await selectConsumerForUpdateSkipLocked(tx, name, instanceId);

  if (!rawState) {
    return { state: null, skip: "not_registered" };
  }

  const state = coerceRow(rawState, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow;

  if (!state) {
    // Either the row never existed (no pre-reg, no ensureRegistered) or
    // another instance currently holds the lock with SKIP LOCKED filtering
    // us out. We can't distinguish here in a single query, so return
    // "not_registered" — ops sees a skip-reason instead of silent delivery
    // loss. Under normal operation (start() called, no external tampering)
    // this path is never taken.
    return { state: null, skip: "not_registered" };
  }

  if (state.status === ConsumerStatuses.disabled) return { state: null, skip: "disabled" };
  if (state.status === ConsumerStatuses.dead) {
    // Bounded auto-revival: a transient failure (e.g. a Meilisearch blip)
    // shouldn't need an operator to notice and run restartConsumer() once
    // the cause is long gone. Cooldown since the last write (the death or
    // a prior re-arm) gates the retry; maxRearmCount stops a poison event
    // from looping forever (re-arm → same event fails → dead → re-arm →
    // ...) — after the cap it stays dead until a human intervenes.
    const cooldownDeadline = TemporalPolyfill.Now.instant().subtract({
      milliseconds: rearmCooldownMs,
    });
    // @cast-boundary temporal-polyfill-vs-ambient: same TC39 Temporal.Instant
    // at runtime — state.updatedAt is DB-row-typed against the ambient
    // global, two distinct nominal types across the two .d.ts sources (see
    // event-store.ts).
    const cooldownElapsed =
      TemporalPolyfill.Instant.compare(
        state.updatedAt as unknown as InstanceType<typeof TemporalPolyfill.Instant>,
        cooldownDeadline,
      ) <= 0;
    if (cooldownElapsed && state.rearmCount < maxRearmCount) {
      const rearmed = await rearmDeadConsumer(tx, name, instanceId);
      const rearmedState =
        rearmed &&
        (coerceRow(rearmed, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow);
      if (rearmedState) return { state: rearmedState, skip: null };
    }
    // Caller (event-dispatcher.ts's processConsumer) emits
    // kumiko_event_consumer_rearm_exhausted_total once per (consumer,
    // instance) transition into this branch — it has the process-lifetime
    // state to dedupe across poll passes that this pure function doesn't.
    return { state: null, skip: "dead" };
  }
  return { state, skip: null };
}

export type ConsumerCursor = {
  readonly lastProcessedEventId: bigint;
  readonly pendingGaps: readonly PendingGapEntry[];
};

// Blocking FOR UPDATE (not SKIP LOCKED): callers of this one need to actually
// wait for the dispatcher's own turn to finish, not skip past it, so their
// read of the already-applied cursor is guaranteed to be up to date rather
// than possibly stale.
export async function selectConsumerCursorForUpdate(
  db: DbRunner,
  name: string,
  instanceId: string,
): Promise<ConsumerCursor | undefined> {
  const rawState = await selectConsumerForUpdate(db, name, instanceId);
  if (!rawState) return undefined;
  const state = coerceRow(rawState, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow;
  return { lastProcessedEventId: state.lastProcessedEventId, pendingGaps: state.pendingGaps };
}

// Read-only pre-check run once per doPass, before any consumer's turn opens
// a transaction (event-dispatcher.ts's doPass/runConsumerTurn). Keyed like
// consumerBackoff/inFlightTurns: `${name}:${instanceId}`. Consumers not
// provably idle (missing row, dead, pending gaps, or an event past cursor)
// simply don't appear in the result — the caller falls through to the
// existing acquireConsumerState/FOR UPDATE SKIP LOCKED path unchanged.
//
// Race: an event that commits between this query and the next tick CAN
// make this snapshot stale — that's expected, not a bug. What it can't do
// is get silently lost: the append fires NOTIFY (or the next poll tick
// fires regardless), triggering a fresh doPass. That pass's own pre-check
// sees the new head id and excludes the consumer from "idle"; a new
// pending_gap only ever gets created when a later turn's fetch (id > the
// old cursor) walks past the row that committed late, and this same
// pre-check reads pending_gaps live on every pass, so it observes that gap
// too. In short: this can under-report idleness for one tick, never
// over-report it.
export async function selectIdleConsumerKeys(
  db: DbConnection,
  pairs: ReadonlyArray<{ readonly name: string; readonly instanceId: string }>,
): Promise<ReadonlySet<string>> {
  if (pairs.length === 0) return new Set();
  const names = pairs.map((p) => p.name);
  const instanceIds = pairs.map((p) => p.instanceId);
  const idlePairs = await selectProvablyIdleConsumerPairs(
    db,
    names,
    instanceIds,
    ConsumerStatuses.dead,
  );
  return new Set(idlePairs.map((p) => `${p.name}:${p.instanceId}`));
}

// Shared pre-registration: one row per (consumer, shard), cursor = 0,
// status = idle. Shared-delivery consumers use SHARED_INSTANCE_SENTINEL;
// per-instance consumers use the dispatcher's instanceId. Idempotent
// under restart and concurrent start-calls via ON CONFLICT DO NOTHING
// on the composite PK — never clobbers an existing cursor.
export async function preRegisterConsumers(
  db: DbConnection,
  consumers: readonly EventConsumer[],
  dispatcherInstanceId: string | undefined,
): Promise<void> {
  for (const consumer of consumers) {
    const instanceId = consumerInstanceId(consumer, dispatcherInstanceId);
    await insertConsumerIfAbsent(db, consumer.name, instanceId, consumer.startFrom);
  }
}

// Resolve the instance_id column value for one consumer on this dispatcher.
// Shared stays at the sentinel; per-instance rides the dispatcher's id.
// Throws when a per-instance consumer is registered without an instanceId
// — missing at boot is the sharp-edge to catch, not at first delivery.
export function consumerInstanceId(
  consumer: EventConsumer,
  dispatcherInstanceId: string | undefined,
): string {
  if (consumer.delivery !== "per-instance") return SHARED_INSTANCE_SENTINEL;
  if (!dispatcherInstanceId) {
    throw new Error(
      `EventConsumer "${consumer.name}" has delivery="per-instance" but the dispatcher was created without an instanceId — ` +
        `pass EventDispatcherOptions.instanceId (typically from ServerOptions.instanceId / KUMIKO_INSTANCE_ID).`,
    );
  }
  return dispatcherInstanceId;
}

// Mark the consumer row as "processing" for ops visibility. The SKIP LOCKED
// lock already guarantees single-writer semantics; this is purely
// informational (and resets on commit to idle/dead via persistConsumerOutcome).
export async function markProcessing(tx: DbTx, name: string, instanceId: string): Promise<void> {
  await markConsumerProcessing(tx, name, instanceId);
}

// `pendingRanges` are id ranges below `cursor` the consumer is still
// watching as gaps (invisible on an earlier turn — see event-dispatcher.ts's
// processConsumer). Fetching them alongside the plain `id > cursor` window
// means a row that committed late becomes visible and deliverable the next
// time this consumer's turn runs, instead of being permanently skipped.
export async function fetchPendingEvents(
  tx: DbTx,
  cursor: bigint,
  batchSize: number,
  pendingRanges: readonly PendingIdRange[] = [],
): Promise<ReadonlyArray<StoredEventRow>> {
  const rawRows = await selectPendingAndNewEventRows(tx, cursor, pendingRanges, batchSize);
  const info = extractTableInfo(eventsTable);
  return rawRows.map((row) => coerceRow(row, info) as StoredEventRow); // @cast-boundary db-row
}

export type DeliveryOutcome = {
  readonly cursor: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly deadLettered: boolean;
  readonly processed: number;
  readonly failed: number;
  // Which of the *pending* ids in `events` (id <= the cursor this delivery
  // started from) got resolved this pass — delivered or skip-applied. The
  // caller (event-dispatcher.ts) splits exactly these out of pending_gaps;
  // everything else in the input batch was a "new" row past the old cursor.
  readonly resolvedPendingIds: readonly bigint[];
};

// Deliver events to the consumer's handler in events.id order, or — when
// the consumer wires a batchHandler — through it in one call first. Halt-
// on-poison: a throw breaks the per-event loop, the cursor stays at the
// last successful event, and attempts climb. At the consumer's
// effectiveMaxAttempts (errorPolicy.maxAttempts ?? maxAttempts) the caller
// persists status="dead" and the consumer is parked until ops intervenes
// (see restartConsumer / skipPoisonEvent). A batch that throws falls back
// to the same per-event loop for the same events — the batch failure
// itself does not bump attempts, only a per-event failure does.
export async function deliverEvents(
  consumer: EventConsumer,
  events: ReadonlyArray<StoredEventRow>,
  context: AppContext,
  maxAttempts: number,
  state: ConsumerStateRow,
): Promise<DeliveryOutcome> {
  const startCursor = state.lastProcessedEventId;
  let cursor = startCursor;
  let attempts = state.attempts;
  let lastError: string | null = state.lastError ?? null;
  let deadLettered = false;
  const effectiveMaxAttempts = consumer.errorPolicy?.maxAttempts ?? maxAttempts;
  let processed = 0;
  let failed = 0;
  const resolvedPendingIds: bigint[] = [];

  // A pending row sits below startCursor: it resolves its gap but never moves
  // the cursor backward. ORDER BY id walks all pending rows first.
  const resolve = (id: bigint): void => {
    if (id > cursor) cursor = id;
    if (id <= startCursor) resolvedPendingIds.push(id);
    attempts = 0;
    lastError = null;
  };

  if (consumer.batchHandler && events.length > 0) {
    const batchSucceeded = await tryApplyBatch(consumer, events, context);
    if (batchSucceeded) {
      for (const row of events) resolve(row.id);
      processed = events.length;
      return { cursor, attempts, lastError, deadLettered, processed, failed, resolvedPendingIds };
    }
    // fall through to the per-event loop below; the batch failure itself
    // does NOT bump attempts — only a per-event failure does.
  }

  for (const row of events) {
    try {
      await applyEvent(consumer, row, context);
      resolve(row.id);
      processed += 1;
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : String(e);
      failed += 1;
      if (consumer.errorPolicy?.skipApplyErrors) {
        reportSkippedEvent(consumer, row.id, e, errMessage, context);
        resolve(row.id);
        continue;
      }
      attempts += 1;
      lastError = errMessage;
      if (attempts >= effectiveMaxAttempts) deadLettered = true;
      break;
    }
  }

  return { cursor, attempts, lastError, deadLettered, processed, failed, resolvedPendingIds };
}

// Shared requestContext scope for one apply — event-derived fields
// (correlationId, causationId, writeOrigin) come from `causationSource`;
// applyEvent uses the event itself, applyBatch uses the LAST event of the
// turn (see applyBatch for why). requestId falls back to a fresh id
// because the dispatcher runs outside any HTTP request (background poll),
// and a stable log-correlation handle is still useful for debugging.
// #3043 — an event this apply writes is attributed to the consumer, not
// to whatever wrote the triggering event; causationId already links back.
function buildConsumerRequestScope(
  consumer: EventConsumer,
  causationSource: StoredEvent,
): RequestContextData {
  const correlationId = causationSource.metadata.correlationId ?? requestContext.generateId();
  const causationId = String(causationSource.id);
  const requestId = requestContext.generateId();
  // The job-trigger consumer's handleEvent stamps event-triggered jobs from this.
  const rawStoredWriteOrigin = causationSource.metadata.writeOrigin;
  const writeOrigin =
    rawStoredWriteOrigin === undefined
      ? undefined
      : (parseWriteOrigin(rawStoredWriteOrigin) ?? UNPARSEABLE_STORED_WRITE_ORIGIN);
  return {
    requestId,
    correlationId,
    causationId,
    handler: consumer.name,
    feature: consumer.featureName ?? qnScope(consumer.name),
    writeOrigin,
  };
}

async function applyEvent(
  consumer: EventConsumer,
  row: StoredEventRow,
  context: AppContext,
): Promise<void> {
  const stored = rowToStoredEvent(row);
  await requestContext.run(buildConsumerRequestScope(consumer, stored), async () => {
    await consumer.handler(stored, context);
  });
}

// Runs the consumer's batchHandler for the whole turn under one
// requestContext scope, attempted before the per-event loop. Returns
// false on failure instead of rethrowing — the caller falls back to
// per-event delivery for the exact same events, so a batch failure must
// not itself count as an applyEvent failure or bump attempts.
async function tryApplyBatch(
  consumer: EventConsumer,
  events: ReadonlyArray<StoredEventRow>,
  context: AppContext,
): Promise<boolean> {
  try {
    await applyBatch(consumer, events, context);
    return true;
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : String(e);
    context.log?.warn(
      `event-dispatcher: ${consumer.name} batch of ${events.length} failed, falling back to per-event delivery: ${errMessage}`,
    );
    return false;
  }
}

async function applyBatch(
  consumer: EventConsumer,
  events: ReadonlyArray<StoredEventRow>,
  context: AppContext,
): Promise<void> {
  const batchHandler = consumer.batchHandler;
  // skip: deliverEvents only calls this for consumers that wire a batchHandler.
  if (!batchHandler) return;
  const stored = events.map((row) => rowToStoredEvent(row));
  // correlationId/causationId/writeOrigin come from the LAST row — a
  // batch-appended event's causation is attributed to the turn's most
  // recent input, same as chaining N applyEvent calls would leave the
  // requestContext at after the final one.
  const lastStored = stored.at(-1);
  // skip: deliverEvents never calls this with an empty turn.
  if (!lastStored) return;
  await requestContext.run(buildConsumerRequestScope(consumer, lastStored), async () => {
    await batchHandler(stored, context);
  });
}

// Best-effort mode: record the error on the skip counter so ops can alert on
// a spike of skipped events; the consumer stays "idle", not "dead". The
// warn-level log line tells them WHICH events — without it a
// poisoned-then-skipped event is invisible to forensic search.
function reportSkippedEvent(
  consumer: EventConsumer,
  eventId: bigint,
  e: unknown,
  errMessage: string,
  context: AppContext,
): void {
  const errorClass = e instanceof Error ? e.constructor.name : "UnknownError";
  emitDispatcherError(context.meter ?? getFallbackMeter(), { handler: consumer.name, errorClass });
  context.log?.warn(
    `event-dispatcher: ${consumer.name} skipped event ${eventId} (${errorClass}): ${errMessage}`,
  );
}

export type PersistedConsumerOutcome = DeliveryOutcome & {
  readonly pendingGaps: readonly PendingGapEntry[];
};

export async function persistConsumerOutcome(
  tx: DbTx,
  name: string,
  instanceId: string,
  outcome: PersistedConsumerOutcome,
): Promise<void> {
  await updateConsumerDeliveryOutcome(tx, name, instanceId, outcome);
}

// Best-effort record of a pass that threw before persistConsumerOutcome
// could run (event-dispatcher.ts's processConsumer catch). The caller opens
// its OWN transaction for this — the one that rolled back never committed
// anything, including this write, if it happened inside the same tx.
export async function persistConsumerPassFailure(
  tx: DbTx,
  name: string,
  instanceId: string,
  errorMessage: string,
): Promise<void> {
  await recordConsumerPassFailure(tx, name, instanceId, errorMessage);
}

// Emit the lag gauge inside the consumer pass's tx so ops sees a snapshot
// consistent with the cursor we just advanced to. `MAX(id)` on the events
// table is an O(1) reverse-index scan — cheap even under load.
export async function emitLagFromTx(
  tx: DbTx,
  consumerName: string,
  instanceId: string,
  cursor: bigint,
  meter: Meter,
): Promise<void> {
  const head = await selectEventsHeadId(tx);
  const lag = head > cursor ? Number(head - cursor) : 0;
  emitEventConsumerLag(meter, { consumer: consumerName, instanceId }, lag);
}
