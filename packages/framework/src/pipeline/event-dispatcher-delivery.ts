import { requestContext } from "../api/request-context";
import type { DbConnection, DbTx } from "../db/connection";
import {
  insertConsumerIfAbsent,
  markConsumerProcessing,
  rearmDeadConsumer,
  selectConsumerForUpdateSkipLocked,
  updateConsumerDeliveryOutcome,
} from "../db/queries/event-consumer";
import { selectEventsHeadId } from "../db/queries/event-store";
import { coerceRow, extractTableInfo, selectMany } from "../db/query";
import type { AppContext } from "../engine/types";
import { eventsTable, toStoredEvent as rowToStoredEvent } from "../event-store";
import {
  emitDispatcherError,
  emitEventConsumerLag,
  getFallbackMeter,
  type Meter,
} from "../observability";
import {
  ConsumerStatuses,
  eventConsumerStateTable,
  SHARED_INSTANCE_SENTINEL,
} from "./event-consumer-state";
import type { EventConsumer } from "./event-dispatcher";

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
    const cooldownDeadline = Temporal.Now.instant().subtract({ milliseconds: rearmCooldownMs });
    const cooldownElapsed = Temporal.Instant.compare(state.updatedAt, cooldownDeadline) <= 0;
    if (cooldownElapsed && state.rearmCount < maxRearmCount) {
      const rearmed = await rearmDeadConsumer(tx, name, instanceId);
      const rearmedState =
        rearmed &&
        (coerceRow(rearmed, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow);
      if (rearmedState) return { state: rearmedState, skip: null };
    }
    // ponytail: no log/metric fires when the rearm budget is exhausted here
    // (the exact "braucht manuellen Eingriff" moment) — queryable via
    // getConsumerState but silent otherwise. Add an emitDispatcherError-style
    // signal if ops needs a push instead of a dead+lag poll.
    return { state: null, skip: "dead" };
  }
  return { state, skip: null };
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
    await insertConsumerIfAbsent(db, consumer.name, instanceId);
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

export async function fetchPendingEvents(
  tx: DbTx,
  cursor: bigint,
  batchSize: number,
): Promise<ReadonlyArray<StoredEventRow>> {
  return (await selectMany(
    tx,
    eventsTable,
    { id: { gt: cursor } },
    { orderBy: { col: "id", direction: "asc" }, limit: batchSize },
  )) as ReadonlyArray<StoredEventRow>; // @cast-boundary db-row
}

export type DeliveryOutcome = {
  readonly cursor: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly deadLettered: boolean;
  readonly processed: number;
  readonly failed: number;
};

// Deliver events to the consumer's handler in events.id order. Halt-on-
// poison: a throw breaks the loop, the cursor stays at the last successful
// event, and attempts climb. At the consumer's effectiveMaxAttempts
// (errorPolicy.maxAttempts ?? maxAttempts) the caller persists status=
// "dead" and the consumer is parked until ops intervenes (see
// restartConsumer / skipPoisonEvent).
export async function deliverEvents(
  consumer: EventConsumer,
  events: ReadonlyArray<StoredEventRow>,
  context: AppContext,
  maxAttempts: number,
  state: ConsumerStateRow,
): Promise<DeliveryOutcome> {
  let cursor = state.lastProcessedEventId;
  let attempts = state.attempts;
  let lastError: string | null = state.lastError ?? null;
  let deadLettered = false;
  const effectiveMaxAttempts = consumer.errorPolicy?.maxAttempts ?? maxAttempts;
  let processed = 0;
  let failed = 0;

  for (const row of events) {
    try {
      // Propagate causation: if the handler calls ctx.appendEvent, the new
      // event should record THIS event as its cause. correlationId is
      // inherited unchanged — it survives the hop across streams by design.
      // requestId falls back to a fresh id because the dispatcher runs
      // outside any HTTP request (background poll), and a stable log-
      // correlation handle is still useful for debugging.
      const stored = rowToStoredEvent(row);
      const correlationId = stored.metadata.correlationId ?? requestContext.generateId();
      const causationId = String(stored.id);
      const requestId = requestContext.generateId();
      await requestContext.run({ requestId, correlationId, causationId }, async () => {
        await consumer.handler(stored, context);
      });
      cursor = row.id;
      attempts = 0;
      lastError = null;
      processed += 1;
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : String(e);
      if (consumer.errorPolicy?.skipApplyErrors) {
        // Best-effort mode: record the error on the skip counter so ops
        // can alert on a spike of skipped events, advance the cursor past
        // the bad event, keep going. The consumer stays "idle", not "dead".
        // Also emit a warn-level log line — the metric tells ops THAT events
        // are being dropped, the log tells them WHICH events. Without this
        // a poisoned-then-skipped event is invisible to forensic search.
        const errorClass = e instanceof Error ? e.constructor.name : "UnknownError";
        emitDispatcherError(context.meter ?? getFallbackMeter(), {
          handler: consumer.name,
          errorClass,
        });
        context.log?.warn(
          `event-dispatcher: ${consumer.name} skipped event ${row.id} (${errorClass}): ${errMessage}`,
        );
        cursor = row.id;
        attempts = 0;
        lastError = null;
        failed += 1;
        continue;
      }
      attempts += 1;
      lastError = errMessage;
      failed += 1;
      if (attempts >= effectiveMaxAttempts) deadLettered = true;
      break;
    }
  }

  return { cursor, attempts, lastError, deadLettered, processed, failed };
}

export async function persistConsumerOutcome(
  tx: DbTx,
  name: string,
  instanceId: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  await updateConsumerDeliveryOutcome(tx, name, instanceId, outcome);
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
