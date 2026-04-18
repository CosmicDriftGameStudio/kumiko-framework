import { asc, eq, gt, sql } from "drizzle-orm";
import { requestContext } from "../api/request-context";
import type { DbConnection, DbTx, PgClient } from "../db/connection";
import type { AppContext } from "../engine/types";
import { EVENTS_PUBSUB_CHANNEL, eventsTable, type StoredEvent } from "../event-store";
import {
  emitDispatcherError,
  emitEventConsumerLag,
  emitEventConsumerPassOutcome,
  emitEventDispatcherListenConnected,
  getFallbackMeter,
  getFallbackTracer,
  type Meter,
  type Tracer,
} from "../observability";
import { ConsumerStatuses, eventConsumerStateTable } from "./event-consumer-state";

// Async event-dispatcher — the "AsyncDaemon"-pendant for Kumiko.
//
// Consumers (SSE broadcast, search-index, cross-feature subscribers, and —
// later — async projections) read the events-table via a persistent cursor
// held in kumiko_event_consumers. One row per consumer, one independent
// cursor. A stalled Meili consumer doesn't block SSE; a dead subscription
// doesn't pause the others.
//
// Run loop, per consumer, per pass:
//   1. BEGIN
//   2. SELECT state row FOR UPDATE SKIP LOCKED
//      — multi-instance-safe: if another poller holds the lock, this pass
//        skips this consumer and tries the next. No duplicate delivery.
//   3. SELECT events WHERE id > lastProcessedEventId ORDER BY id ASC LIMIT batchSize
//   4. For each event: call the consumer's handler
//        - handler throws → increment attempts, mark status="dead" at
//          maxAttempts, surface lastError, STOP this consumer's pass
//          (later events aren't consumed out-of-order)
//        - handler succeeds → advance cursor, reset attempts
//   5. COMMIT — cursor update + dead-letter flag land atomic
//
// Order guarantee: per-consumer, events are applied in events.id order. We
// don't skip past a failing event — ops has to fix it or mark the consumer
// disabled. This matches Marten's subscription semantics (and EventStoreDB's
// persistent subscriptions): strictly-ordered + halt-on-poison.
//
// Delivery semantics: **at-least-once**. If a handler runs but the cursor
// update fails (crash mid-pass), the same event is delivered again next pass.
// Handlers MUST be idempotent.

export type EventConsumerHandler = (event: StoredEvent, ctx: AppContext) => Promise<void>;

// Per-consumer error policy. When skipApplyErrors is true and handler throws,
// the dispatcher logs the error, advances the cursor past the offending event,
// and keeps delivering — instead of the default retry + dead-letter flow.
// Wire by copying MultiStreamProjectionDefinition.errorMode.continuous into
// the EventConsumer (see api/server.ts MSP wiring).
export type EventConsumerErrorPolicy = {
  readonly skipApplyErrors?: boolean;
};

export type EventConsumer = {
  readonly name: string;
  readonly handler: EventConsumerHandler;
  readonly errorPolicy?: EventConsumerErrorPolicy;
};

export type EventDispatcher = {
  start(): Promise<void>;
  stop(): Promise<void>;
  // Force one pass now (tests drain deterministically via this).
  // Throws if start() was never called — pre-registration of consumer
  // state rows is a precondition, not a side-effect of the pass itself.
  runOnce(): Promise<{
    readonly processed: number;
    readonly failed: number;
    readonly byConsumer: Record<string, { processed: number; failed: number }>;
  }>;
  // Idempotent re-pre-registration of consumer state rows. Exists as a
  // test-teardown surface: after `TRUNCATE kumiko_event_consumers` the
  // rows are gone, and strict acquire() would skip every consumer as
  // "not_registered". Tests call ensureRegistered() to repopulate without
  // a full stop/start cycle. Production never needs this — start() runs
  // it once on boot and the rows survive dispatcher lifetime.
  ensureRegistered(): Promise<void>;
};

export type EventDispatcherOptions = {
  readonly db: DbConnection;
  readonly consumers: readonly EventConsumer[];
  readonly context: AppContext;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  readonly maxAttempts?: number;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  // Optional raw postgres.js client for LISTEN/NOTIFY-based wake-up
  // (Sprint E.4). When present, `.start()` subscribes to EVENTS_PUBSUB_CHANNEL
  // and fires runOnce on each NOTIFY — delivery latency becomes TCP-round-
  // trip instead of pollIntervalMs. The polling timer remains active as a
  // safety net (missed NOTIFYs from crashes, subscription drops).
  readonly pgClient?: PgClient;
};

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_POLL_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 10;

// --- processConsumer helpers ---
// Free functions (not closures) so they're independently readable and the
// dispatcher's main pass logic stays under ~50 LOC. Every helper takes an
// explicit `tx` — none of them use the outer dispatcher's closure state.

type ConsumerStateRow = typeof eventConsumerStateTable.$inferSelect;

type AcquireOutcome =
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
async function acquireConsumerState(tx: DbTx, name: string): Promise<AcquireOutcome> {
  const [state] = (await tx
    .select()
    .from(eventConsumerStateTable)
    .where(eq(eventConsumerStateTable.name, name))
    .for("update", { skipLocked: true })) as [ConsumerStateRow | undefined];

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
  if (state.status === ConsumerStatuses.dead) return { state: null, skip: "dead" };
  return { state, skip: null };
}

// Shared pre-registration: one row per consumer, cursor = 0, status = idle.
// Idempotent under restart and concurrent start-calls via ON CONFLICT
// DO NOTHING. Never clobbers an existing cursor.
async function preRegisterConsumers(
  db: DbConnection,
  consumers: readonly EventConsumer[],
): Promise<void> {
  for (const consumer of consumers) {
    await db
      .insert(eventConsumerStateTable)
      .values({ name: consumer.name, status: "idle" })
      .onConflictDoNothing({ target: eventConsumerStateTable.name });
  }
}

// Mark the consumer row as "processing" for ops visibility. The SKIP LOCKED
// lock already guarantees single-writer semantics; this is purely
// informational (and resets on commit to idle/dead via persistConsumerOutcome).
async function markProcessing(tx: DbTx, name: string): Promise<void> {
  await tx
    .update(eventConsumerStateTable)
    .set({ status: "processing", updatedAt: sql`now()` })
    .where(eq(eventConsumerStateTable.name, name));
}

async function fetchPendingEvents(
  tx: DbTx,
  cursor: bigint,
  batchSize: number,
): Promise<ReadonlyArray<typeof eventsTable.$inferSelect>> {
  return (await tx
    .select()
    .from(eventsTable)
    .where(gt(eventsTable.id, cursor))
    .orderBy(asc(eventsTable.id))
    .limit(batchSize)) as ReadonlyArray<typeof eventsTable.$inferSelect>;
}

type DeliveryOutcome = {
  readonly cursor: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly deadLettered: boolean;
  readonly processed: number;
  readonly failed: number;
};

function rowToStoredEvent(row: typeof eventsTable.$inferSelect): StoredEvent {
  return {
    id: String(row.id),
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    tenantId: row.tenantId,
    version: row.version,
    type: row.type,
    eventVersion: row.eventVersion,
    payload: row.payload,
    metadata: row.metadata,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

// Deliver events to the consumer's handler in events.id order. Halt-on-
// poison: a throw breaks the loop, the cursor stays at the last successful
// event, and attempts climb. At maxAttempts the caller persists status=
// "dead" and the consumer is parked until ops intervenes (see
// restartConsumer / skipPoisonEvent).
async function deliverEvents(
  consumer: EventConsumer,
  events: ReadonlyArray<typeof eventsTable.$inferSelect>,
  context: AppContext,
  maxAttempts: number,
  state: ConsumerStateRow,
): Promise<DeliveryOutcome> {
  let cursor = state.lastProcessedEventId;
  let attempts = state.attempts;
  let lastError: string | null = state.lastError ?? null;
  let deadLettered = false;
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
        const errorClass = e instanceof Error ? e.constructor.name : "UnknownError";
        emitDispatcherError(context.meter ?? getFallbackMeter(), {
          handler: consumer.name,
          errorClass,
        });
        cursor = row.id;
        attempts = 0;
        lastError = null;
        failed += 1;
        continue;
      }
      attempts += 1;
      lastError = errMessage;
      failed += 1;
      if (attempts >= maxAttempts) deadLettered = true;
      break;
    }
  }

  return { cursor, attempts, lastError, deadLettered, processed, failed };
}

async function persistConsumerOutcome(
  tx: DbTx,
  name: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  await tx
    .update(eventConsumerStateTable)
    .set({
      lastProcessedEventId: outcome.cursor,
      attempts: outcome.attempts,
      status: outcome.deadLettered ? "dead" : "idle",
      lastError: outcome.lastError,
      updatedAt: sql`now()`,
    })
    .where(eq(eventConsumerStateTable.name, name));
}

// Emit the lag gauge inside the consumer pass's tx so ops sees a snapshot
// consistent with the cursor we just advanced to. `MAX(id)` on the events
// table is an O(1) reverse-index scan — cheap even under load.
async function emitLagFromTx(
  tx: DbTx,
  consumerName: string,
  cursor: bigint,
  meter: Meter,
): Promise<void> {
  const result = await tx.execute(sql`SELECT COALESCE(MAX(id), 0)::bigint AS head FROM events`);
  const rows = Array.isArray(result) ? (result as Array<{ head?: bigint | string | null }>) : [];
  const raw = rows[0]?.head;
  const head = typeof raw === "bigint" ? raw : BigInt(raw ?? 0);
  const lag = head > cursor ? Number(head - cursor) : 0;
  emitEventConsumerLag(meter, { consumer: consumerName }, lag);
}

export function createEventDispatcher(options: EventDispatcherOptions): EventDispatcher {
  const {
    db,
    consumers,
    context,
    batchSize = DEFAULT_BATCH_SIZE,
    pollIntervalMs = DEFAULT_POLL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;
  const tracer: Tracer = options.tracer ?? getFallbackTracer();
  const meter: Meter = options.meter ?? getFallbackMeter();

  let running = false;
  // Separate from `running` on purpose: pre-registration of consumer state
  // rows is a one-time boot action, while running/timer/LISTEN is a
  // lifecycle toggle. stop() flips running back to false but leaves
  // preRegistered true — a subsequent runOnce() is still safe because the
  // state rows are in place. Production code never stops-then-runs-once;
  // tests do (drain on-demand without a timer loop).
  let preRegistered = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // LISTEN subscription handle. Set when .start() successfully subscribed
  // to EVENTS_PUBSUB_CHANNEL; cleared by .stop(). The timer remains active
  // even with LISTEN attached — it's a cheap safety net against missed
  // NOTIFYs (subscription drop, crash mid-commit).
  let pgUnlisten: (() => Promise<void>) | null = null;

  // Serialises concurrent runOnce() calls from both wake-up sources (timer
  // + any future explicit nudge). Mirrors outbox-poller's passInFlight
  // pattern so behaviour under races stays predictable.
  let passInFlight: Promise<{
    processed: number;
    failed: number;
    byConsumer: Record<string, { processed: number; failed: number }>;
  }> | null = null;

  async function runOnce(): Promise<{
    processed: number;
    failed: number;
    byConsumer: Record<string, { processed: number; failed: number }>;
  }> {
    if (!preRegistered) {
      throw new Error(
        "EventDispatcher.runOnce() called before start() — consumer state rows are not registered. Call start() first (production) or ensureRegistered() (tests after truncating kumiko_event_consumers).",
      );
    }
    if (passInFlight) return passInFlight;
    passInFlight = doPass();
    try {
      return await passInFlight;
    } finally {
      passInFlight = null;
    }
  }

  async function doPass(): Promise<{
    processed: number;
    failed: number;
    byConsumer: Record<string, { processed: number; failed: number }>;
  }> {
    let totalProcessed = 0;
    let totalFailed = 0;
    const byConsumer: Record<string, { processed: number; failed: number }> = {};

    // Seriell pro consumer. Parallelisierung wäre möglich (je eigene TX), aber
    // das einfache Modell reicht für v1 — jeder consumer hat geringe
    // per-event-Arbeit (network call at worst). Bei hunderten Events pro
    // Batch lohnt sich Parallelisierung — Optimierung für später.
    for (const consumer of consumers) {
      const perConsumer = await processConsumer(consumer);
      byConsumer[consumer.name] = perConsumer;
      totalProcessed += perConsumer.processed;
      totalFailed += perConsumer.failed;
    }

    return { processed: totalProcessed, failed: totalFailed, byConsumer };
  }

  async function processConsumer(
    consumer: EventConsumer,
  ): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    const span = tracer.startSpan("events.consumer.pass", {
      attributes: { "consumer.name": consumer.name },
    });

    try {
      await db.transaction(async (tx) => {
        const acquired = await acquireConsumerState(tx, consumer.name);
        // skip: another instance holds the lock, or the consumer is
        // disabled/dead. Nothing to deliver this pass.
        if (acquired.skip !== null) {
          span.setAttribute("consumer.skip_reason", acquired.skip);
          return;
        }
        await markProcessing(tx, consumer.name);

        const events = await fetchPendingEvents(tx, acquired.state.lastProcessedEventId, batchSize);
        const outcome = await deliverEvents(consumer, events, context, maxAttempts, acquired.state);
        processed = outcome.processed;
        failed = outcome.failed;

        await persistConsumerOutcome(tx, consumer.name, outcome);
        await emitLagFromTx(tx, consumer.name, outcome.cursor, meter);
      });

      emitEventConsumerPassOutcome(meter, { consumer: consumer.name }, processed, failed);
      span.setAttribute("consumer.processed", processed);
      span.setAttribute("consumer.failed", failed);
      span.setStatus(failed === 0 ? "ok" : "error");
    } catch (e) {
      // Unexpected: a handler error is caught inside deliverEvents and
      // surfaces via `failed`, so anything landing here is infrastructure
      // (db connection lost, serialization, standard-metrics not registered
      // on this meter). Don't let one consumer's outage stall the others,
      // but do log — a silent rollback here looks like "at-most-once" to
      // callers and at-least-once-with-duplicate-delivery on the next pass;
      // neither is what we want, so ops needs to see it.
      const msg = e instanceof Error ? e.message : String(e);
      context.log?.error(`[event-dispatcher] ${consumer.name} pass failed: ${msg}`);
      span.setStatus("error", msg);
    } finally {
      span.end();
    }

    return { processed, failed };
  }

  return {
    async start() {
      // skip: already running, idempotent
      if (running) return;
      running = true;

      // Pre-register consumer state rows. Without this, a consumer first
      // bootstraps lazily on its first runOnce — and if prune runs between
      // "process came up" and "first pass landed", prune wouldn't see the
      // consumer in the state table, would delete events past its (absent)
      // cursor, and the consumer's first pass would silently skip them.
      //
      // Pre-registering turns every consumer into a row-with-cursor-0 the
      // moment the dispatcher starts — so the retention guard
      // (pruneEvents → ConsumerLagError) correctly refuses to prune past
      // any consumer that exists, including freshly-deployed ones.
      await preRegisterConsumers(db, consumers);
      preRegistered = true;

      timer = setInterval(() => {
        void runOnce().catch(() => {
          // skip: per-consumer errors already recorded in the state row
        });
      }, pollIntervalMs);

      // NOTIFY-based wake-up: subscribe on the same channel that
      // event-store.append fires on commit. Fires runOnce directly, no
      // polling round-trip. The timer stays on as a belt-and-braces
      // fallback (dropped subscriptions, missed commits under load).
      //
      // Observability: the gauge kumiko_event_dispatcher_listen_connected
      // flips to 1 on initial subscribe AND on every postgres.js silent
      // reconnect (via the onlisten callback). A drop to 0 while running
      // means delivery latency regressed from TCP-round-trip to
      // pollIntervalMs — ops-visible.
      emitEventDispatcherListenConnected(meter, false);
      if (options.pgClient) {
        try {
          const sub = await options.pgClient.listen(
            EVENTS_PUBSUB_CHANNEL,
            () => {
              void runOnce().catch(() => {
                // skip: per-consumer errors already recorded in the state row
              });
            },
            () => {
              // Fires on initial connect AND on each reconnect. postgres.js
              // reconnects transparently if the TCP connection drops, so the
              // only way to see the recovery window is to flip the gauge
              // every time this callback lands.
              emitEventDispatcherListenConnected(meter, true);
            },
          );
          pgUnlisten = sub.unlisten;
        } catch (e) {
          emitEventDispatcherListenConnected(meter, false);
          const msg = e instanceof Error ? e.message : String(e);
          context.log?.error(`[event-dispatcher] pg LISTEN failed: ${msg}`);
        }
      }
    },

    async stop() {
      // skip: already stopped, idempotent
      if (!running) return;
      running = false;

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (pgUnlisten) {
        await pgUnlisten().catch(() => {
          // skip: unlisten failure only matters during shutdown — the
          // subscription is being torn down anyway.
        });
        pgUnlisten = null;
        emitEventDispatcherListenConnected(meter, false);
      }

      // Drain any in-flight pass so shutdown observes consistent state.
      if (passInFlight) {
        await passInFlight.catch(() => {
          // skip: errors already recorded per-consumer inside the pass
        });
      }
      // preRegistered stays true — the rows survive stop(). runOnce()
      // after a stop() still works (tests stop the timer and then drain
      // deterministically).
    },

    async ensureRegistered() {
      await preRegisterConsumers(db, consumers);
      preRegistered = true;
    },

    runOnce,
  };
}

// --- Ops recovery surface ---
//
// These are intentionally verb-distinct; each maps to a CLI sub-command.
// They all target a single consumer row by name. Every call returns the
// state after the write so the CLI can echo what actually changed.
//
// Semantics:
//   restartConsumer   status="dead" → "idle", attempts=0, lastError=null.
//                     Cursor unchanged → next pass retries the SAME event
//                     that poisoned the consumer. For transient failures.
//   disableConsumer   status=* → "disabled". Dispatcher skips this consumer
//                     until enableConsumer() flips it back.
//   enableConsumer    status="disabled" → "idle". No-op on any other state.
//   skipPoisonEvent   cursor advances past the first event after the
//                     current cursor (the one that's failing). attempts=0,
//                     lastError=null, status="idle". For events that will
//                     never succeed (broken payload, removed feature code).

function normalizeConsumerState(
  row: typeof eventConsumerStateTable.$inferSelect,
): ConsumerRecoveryState {
  return {
    name: row.name,
    status: row.status,
    lastProcessedEventId: row.lastProcessedEventId,
    attempts: row.attempts,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

export type ConsumerRecoveryState = {
  readonly name: string;
  readonly status: string;
  readonly lastProcessedEventId: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly updatedAt: Date;
};

async function requireConsumerRow(
  db: DbConnection,
  name: string,
): Promise<typeof eventConsumerStateTable.$inferSelect> {
  const [row] = await db
    .select()
    .from(eventConsumerStateTable)
    .where(eq(eventConsumerStateTable.name, name));
  if (!row) {
    throw new Error(
      `Consumer "${name}" has no state row — it hasn't run yet, or the name is misspelled.`,
    );
  }
  return row;
}

export async function restartConsumer(
  db: DbConnection,
  name: string,
): Promise<ConsumerRecoveryState> {
  const before = await requireConsumerRow(db, name);
  if (before.status !== "dead") {
    throw new Error(
      `Consumer "${name}" is not dead (status="${before.status}"). Restart only applies to dead consumers; use "enable" for a disabled one.`,
    );
  }
  const [updated] = await db
    .update(eventConsumerStateTable)
    .set({ status: "idle", attempts: 0, lastError: null, updatedAt: sql`now()` })
    .where(eq(eventConsumerStateTable.name, name))
    .returning();
  if (!updated) {
    throw new Error(`Consumer "${name}" vanished between read and write — retry.`);
  }
  return normalizeConsumerState(updated);
}

export async function disableConsumer(
  db: DbConnection,
  name: string,
): Promise<ConsumerRecoveryState> {
  await requireConsumerRow(db, name);
  const [updated] = await db
    .update(eventConsumerStateTable)
    .set({ status: "disabled", updatedAt: sql`now()` })
    .where(eq(eventConsumerStateTable.name, name))
    .returning();
  if (!updated) {
    throw new Error(`Consumer "${name}" vanished between read and write — retry.`);
  }
  return normalizeConsumerState(updated);
}

export async function enableConsumer(
  db: DbConnection,
  name: string,
): Promise<ConsumerRecoveryState> {
  const before = await requireConsumerRow(db, name);
  if (before.status !== "disabled") {
    throw new Error(
      `Consumer "${name}" is not disabled (status="${before.status}"). Enable only flips disabled → idle; use "restart" for a dead consumer.`,
    );
  }
  const [updated] = await db
    .update(eventConsumerStateTable)
    .set({ status: "idle", attempts: 0, lastError: null, updatedAt: sql`now()` })
    .where(eq(eventConsumerStateTable.name, name))
    .returning();
  if (!updated) {
    throw new Error(`Consumer "${name}" vanished between read and write — retry.`);
  }
  return normalizeConsumerState(updated);
}

// skipPoisonEvent advances the cursor past the first event after the
// current cursor. Single TX so concurrent dispatcher passes can't double-
// advance. If no event exists past the cursor, there is nothing to skip —
// treat as idempotent no-op (cursor already at head).
export async function skipPoisonEvent(
  db: DbConnection,
  name: string,
): Promise<ConsumerRecoveryState & { readonly skippedEventId: bigint | null }> {
  const before = await requireConsumerRow(db, name);
  return db.transaction(async (tx) => {
    const [poison] = (await tx
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(gt(eventsTable.id, before.lastProcessedEventId))
      .orderBy(asc(eventsTable.id))
      .limit(1)) as ReadonlyArray<{ id: bigint }>;
    if (!poison) {
      const [unchanged] = await tx
        .select()
        .from(eventConsumerStateTable)
        .where(eq(eventConsumerStateTable.name, name));
      if (!unchanged) throw new Error(`Consumer "${name}" vanished — retry.`);
      return { ...normalizeConsumerState(unchanged), skippedEventId: null };
    }
    const [updated] = await tx
      .update(eventConsumerStateTable)
      .set({
        lastProcessedEventId: poison.id,
        status: "idle",
        attempts: 0,
        lastError: null,
        updatedAt: sql`now()`,
      })
      .where(eq(eventConsumerStateTable.name, name))
      .returning();
    if (!updated) throw new Error(`Consumer "${name}" vanished mid-skip — retry.`);
    return { ...normalizeConsumerState(updated), skippedEventId: poison.id };
  });
}

// Read-only status for one consumer — CLI surface.
export async function getConsumerState(
  db: DbConnection,
  name: string,
): Promise<{
  readonly name: string;
  readonly status: string;
  readonly lastProcessedEventId: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly updatedAt: Date;
} | null> {
  const [row] = await db
    .select()
    .from(eventConsumerStateTable)
    .where(eq(eventConsumerStateTable.name, name));
  if (!row) return null;
  return {
    name: row.name,
    status: row.status,
    lastProcessedEventId: row.lastProcessedEventId,
    attempts: row.attempts,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

// List every consumer the registry knows about, joined with its state if any.
// Mirrors listProjectionsWithState — the registry (not the DB) is the
// source-of-truth for which consumers exist.
export async function listConsumersWithState(
  db: DbConnection,
  registeredNames: readonly string[],
): Promise<
  ReadonlyArray<{
    readonly name: string;
    readonly status: string;
    readonly lastProcessedEventId: bigint;
    readonly attempts: number;
    readonly lastError: string | null;
  }>
> {
  const stateRows = await db.select().from(eventConsumerStateTable);
  const stateByName = new Map(stateRows.map((r) => [r.name, r]));

  return registeredNames.map((name) => {
    const s = stateByName.get(name);
    return {
      name,
      status: s?.status ?? "never-run",
      lastProcessedEventId: s?.lastProcessedEventId ?? 0n,
      attempts: s?.attempts ?? 0,
      lastError: s?.lastError ?? null,
    };
  });
}
