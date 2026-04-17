import { asc, eq, gt, sql } from "drizzle-orm";
import type { DbConnection, DbTx } from "../db/connection";
import type { AppContext } from "../engine/types";
import { eventsTable, type StoredEvent } from "../event-store";
import {
  emitEventConsumerLag,
  emitEventConsumerPassOutcome,
  getFallbackMeter,
  getFallbackTracer,
  type Meter,
  type Tracer,
} from "../observability";
import { eventConsumerStateTable } from "./event-consumer-state";

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

export type EventConsumer = {
  readonly name: string;
  readonly handler: EventConsumerHandler;
};

export type EventDispatcher = {
  start(): Promise<void>;
  stop(): Promise<void>;
  // Force one pass now (tests drain deterministically via this).
  runOnce(): Promise<{
    readonly processed: number;
    readonly failed: number;
    readonly byConsumer: Record<string, { processed: number; failed: number }>;
  }>;
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
  | { readonly state: null; readonly skip: "locked_by_other_instance" | "disabled" | "dead" };

// Lock the consumer's state row with SKIP LOCKED. Two-step bootstrap: first
// try select; if missing, INSERT ON CONFLICT DO NOTHING then re-select. This
// handles the rare race where two pollers both see "no row" and each tries
// to insert — ON CONFLICT keeps it exclusive, and the second FOR UPDATE
// SKIP LOCKED returns nothing to the loser so it bails out of this pass.
async function acquireConsumerState(tx: DbTx, name: string): Promise<AcquireOutcome> {
  let [state] = (await tx
    .select()
    .from(eventConsumerStateTable)
    .where(eq(eventConsumerStateTable.name, name))
    .for("update", { skipLocked: true })) as [ConsumerStateRow | undefined];

  if (!state) {
    await tx
      .insert(eventConsumerStateTable)
      .values({ name, status: "processing" })
      .onConflictDoNothing({ target: eventConsumerStateTable.name });
    [state] = (await tx
      .select()
      .from(eventConsumerStateTable)
      .where(eq(eventConsumerStateTable.name, name))
      .for("update", { skipLocked: true })) as [ConsumerStateRow | undefined];
    if (!state) return { state: null, skip: "locked_by_other_instance" };
  }

  if (state.status === "disabled") return { state: null, skip: "disabled" };
  if (state.status === "dead") return { state: null, skip: "dead" };
  return { state, skip: null };
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
      await consumer.handler(rowToStoredEvent(row), context);
      cursor = row.id;
      attempts = 0;
      lastError = null;
      processed += 1;
    } catch (e) {
      attempts += 1;
      lastError = e instanceof Error ? e.message : String(e);
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
  let timer: ReturnType<typeof setInterval> | null = null;

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

      timer = setInterval(() => {
        void runOnce().catch(() => {
          // skip: per-consumer errors already recorded in the state row
        });
      }, pollIntervalMs);
    },

    async stop() {
      // skip: already stopped, idempotent
      if (!running) return;
      running = false;

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      // Drain any in-flight pass so shutdown observes consistent state.
      if (passInFlight) {
        await passInFlight.catch(() => {
          // skip: errors already recorded per-consumer inside the pass
        });
      }
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
