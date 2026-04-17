import { asc, eq, gt, sql } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
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
        // Lock the consumer's state row with SKIP LOCKED: a second dispatcher
        // instance (different process) won't see a row we hold. If none is
        // returned, either the row doesn't exist yet (first run) or another
        // instance has it — either way we (a) try to create-or-lock and
        // (b) bail out of THIS consumer's pass if someone else owns it.
        //
        // Two-step: try SELECT FOR UPDATE SKIP LOCKED first. Missing row
        // means "we need to bootstrap" → INSERT ON CONFLICT DO NOTHING,
        // then SELECT FOR UPDATE (blocking, short-lived). That avoids the
        // rare-but-real race where two pollers both see "no row" and each
        // tries to INSERT. The ON CONFLICT DO NOTHING keeps it exclusive.
        let [state] = await tx
          .select()
          .from(eventConsumerStateTable)
          .where(eq(eventConsumerStateTable.name, consumer.name))
          .for("update", { skipLocked: true });

        if (!state) {
          // Bootstrap: create-if-missing (idempotent under concurrent pollers)
          // then take a regular FOR UPDATE. If another poller already owns
          // the row at this point, this FOR UPDATE will block briefly — that
          // is correct, we want exactly one pass per consumer.
          await tx
            .insert(eventConsumerStateTable)
            .values({ name: consumer.name, status: "processing" })
            .onConflictDoNothing({ target: eventConsumerStateTable.name });
          [state] = await tx
            .select()
            .from(eventConsumerStateTable)
            .where(eq(eventConsumerStateTable.name, consumer.name))
            .for("update", { skipLocked: true });
          // skip: another poller beat us to the lock after the INSERT; next
          // pass picks this consumer up. Multi-instance-safe no-op.
          if (!state) {
            span.setAttribute("consumer.skip_reason", "locked_by_other_instance");
            return;
          }
        }

        // skip: consumer is paused (disabled by ops) or dead (hit maxAttempts).
        // Its events wait until ops intervenes; other consumers keep running.
        if (state.status === "disabled" || state.status === "dead") {
          span.setAttribute("consumer.skip_reason", state.status);
          return;
        }

        // Mark processing for ops visibility. The lock already prevents
        // concurrent access; status is purely informational.
        await tx
          .update(eventConsumerStateTable)
          .set({ status: "processing", updatedAt: sql`now()` })
          .where(eq(eventConsumerStateTable.name, consumer.name));

        const events = (await tx
          .select()
          .from(eventsTable)
          .where(gt(eventsTable.id, state.lastProcessedEventId))
          .orderBy(asc(eventsTable.id))
          .limit(batchSize)) as ReadonlyArray<typeof eventsTable.$inferSelect>;

        let cursor = state.lastProcessedEventId;
        let attempts = state.attempts;
        let deadLettered = false;
        let lastError: string | null = state.lastError ?? null;

        for (const row of events) {
          const storedEvent: StoredEvent = {
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

          try {
            await consumer.handler(storedEvent, context);
            cursor = row.id;
            attempts = 0;
            lastError = null;
            processed++;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            attempts += 1;
            lastError = message;
            failed += 1;
            // Halt-on-poison: don't advance past a failing event. Next pass
            // retries the SAME event; after maxAttempts it's marked dead
            // and the consumer pauses for ops.
            if (attempts >= maxAttempts) {
              deadLettered = true;
            }
            break;
          }
        }

        await tx
          .update(eventConsumerStateTable)
          .set({
            lastProcessedEventId: cursor,
            attempts,
            status: deadLettered ? "dead" : "idle",
            lastError,
            updatedAt: sql`now()`,
          })
          .where(eq(eventConsumerStateTable.name, consumer.name));

        // Lag-gauge update in the SAME tx so ops sees a snapshot consistent
        // with the cursor we just advanced to. `MAX(id)` on the events table
        // is an O(1) reverse-index scan — cheap even under load.
        const [headRow] = (await tx.execute(
          sql`SELECT COALESCE(MAX(id), 0)::bigint AS head FROM events`,
        )) as unknown as Array<{ head: bigint | string }>;
        const head = typeof headRow?.head === "bigint" ? headRow.head : BigInt(headRow?.head ?? 0);
        const lag = head > cursor ? Number(head - cursor) : 0;
        emitEventConsumerLag(meter, { consumer: consumer.name }, lag);
      });

      emitEventConsumerPassOutcome(meter, { consumer: consumer.name }, processed, failed);
      span.setAttribute("consumer.processed", processed);
      span.setAttribute("consumer.failed", failed);
      span.setStatus(failed === 0 ? "ok" : "error");
    } catch (e) {
      // Unexpected: a handler error is caught inside the loop, so anything
      // landing here is infrastructure (db connection lost, serialization).
      // Don't let one consumer's outage stall the others.
      span.setStatus("error", e instanceof Error ? e.message : String(e));
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
