import { and, asc, eq, isNull } from "drizzle-orm";
import type Redis from "ioredis";
import type { DbConnection } from "../db/connection";
import type { Logger } from "../logging/types";
import { getFallbackTracer, type SerializedTraceContext, type Tracer } from "../observability";
import type { BrokerEvent, EventBroker } from "./event-broker";
import { eventOutboxTable, OUTBOX_WAKE_CHANNEL } from "./outbox-table";

export type DeadLetterEvent = {
  readonly id: number;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly lastError: string;
};

export type OutboxPollerOptions = {
  db: DbConnection;
  // Subscriber instance — needed because ioredis clients in subscribe mode
  // can't issue other commands. The publisher + wake-up uses a separate conn.
  subscriberRedis: Redis;
  eventBroker: EventBroker;
  batchSize?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
  // Fires when a row hits maxAttempts and is marked dead-letter. Use this to
  // wire a metric, page on-call, or push to an ops queue. Errors thrown from
  // the hook are swallowed (the row is already flagged; losing the alert
  // shouldn't crash the poller).
  onDeadLetter?: (event: DeadLetterEvent) => void | Promise<void>;
  // Optional logger — dead-letter rows are logged at error level even without
  // an explicit hook, so an operator always has *something* in the logs.
  log?: Logger;
  // Optional tracer — when set, each published event becomes a span whose
  // parent is the trace context captured at emit time (cross-process trace
  // continuation). Default Noop keeps overhead zero when observability is off.
  tracer?: Tracer;
};

export type OutboxPoller = {
  start(): Promise<void>;
  stop(): Promise<void>;
  // Force one pass now (tests call this instead of waiting for the timer).
  runOnce(): Promise<{ processed: number; failed: number }>;
};

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_POLL_MS = 50;
const DEFAULT_MAX_ATTEMPTS = 10;

// Transactional-Outbox poller.
//
// Two wake-up sources:
//   1. Redis Pub/Sub on OUTBOX_WAKE_CHANNEL — low-latency signal after emit
//   2. Timer (pollIntervalMs) — fallback if Redis is down or publish was lost
//
// Each pass: SELECT next batch of unpublished/non-deadletter rows using
// Drizzle's `.for("update", { skipLocked: true })` (Postgres row-level lock
// that skips already-locked rows), dispatches each row via
// eventBroker.dispatchLocal, marks published or increments attempts. After
// maxAttempts the row is marked dead-letter and skipped forever (no alert,
// no replay in v1).
export function createOutboxPoller(options: OutboxPollerOptions): OutboxPoller {
  const {
    db,
    subscriberRedis,
    eventBroker,
    batchSize = DEFAULT_BATCH_SIZE,
    pollIntervalMs = DEFAULT_POLL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    onDeadLetter,
    log,
  } = options;
  const tracer: Tracer = options.tracer ?? getFallbackTracer();

  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Serialises concurrent runOnce() calls from both wake-up sources (Redis
  // message AND timer tick). Without this, a wake-up that arrives mid-pass
  // would start a second transaction on the same un-locked rows. Whoever
  // arrives during an active pass gets the same in-flight promise back;
  // their rows will be picked up by the next pass after the current one
  // releases its row-level locks.
  let passInFlight: Promise<{ processed: number; failed: number }> | null = null;

  const wakeUpListener = (channel: string) => {
    if (channel !== OUTBOX_WAKE_CHANNEL) {
      // skip: message on different channel, not our wake-up
      return;
    }
    // Fire-and-forget; runOnce serialises internally via passInFlight.
    void runOnce().catch(() => {
      // skip: errors are already recorded on the row; swallow to avoid
      // unhandled-rejection from the wake-up callback path.
    });
  };

  async function runOnce(): Promise<{ processed: number; failed: number }> {
    if (passInFlight) return passInFlight;
    passInFlight = doPass();
    try {
      return await passInFlight;
    } finally {
      passInFlight = null;
    }
  }

  async function doPass(): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    await db.transaction(async (tx) => {
      // Row-level SKIP LOCKED: a second poller instance (different process /
      // node) won't see rows this tx is holding — safe concurrent polling.
      const rows = await tx
        .select({
          id: eventOutboxTable.id,
          eventType: eventOutboxTable.eventType,
          payload: eventOutboxTable.payload,
          attempts: eventOutboxTable.attempts,
          traceContext: eventOutboxTable.traceContext,
        })
        .from(eventOutboxTable)
        .where(and(isNull(eventOutboxTable.publishedAt), eq(eventOutboxTable.deadLetter, false)))
        .orderBy(asc(eventOutboxTable.createdAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });

      for (const row of rows) {
        // Trace-context continuation: if the row carries a serialized parent
        // span (emitted inside a request), start our span as its child so the
        // full request → emit → poller → subscribers chain shows as one trace.
        // Without a captured context we just open a new root span.
        const parentContext = row.traceContext as SerializedTraceContext | null;
        const span = parentContext
          ? tracer.startSpanFromContext("outbox.publish", parentContext, {
              attributes: {
                "outbox.event_type": row.eventType,
                "outbox.attempt": row.attempts + 1,
                "outbox.id": row.id,
              },
            })
          : tracer.startSpan("outbox.publish", {
              attributes: {
                "outbox.event_type": row.eventType,
                "outbox.attempt": row.attempts + 1,
                "outbox.id": row.id,
              },
            });

        try {
          // dispatchLocal runs in-process subscribers synchronously and returns
          // their errors. publish() is fire-and-forget to Redis — cross-process
          // subscribers receive via Redis if they've called broker.start().
          const event: BrokerEvent = {
            type: row.eventType,
            payload: row.payload as Record<string, unknown>,
          };
          const errors = await eventBroker.dispatchLocal(event);

          if (errors.length === 0) {
            try {
              await eventBroker.publish(event);
            } catch {
              // skip: cross-process publish is best-effort; local dispatch
              // already succeeded, so the event is considered delivered.
            }
            await tx
              .update(eventOutboxTable)
              .set({ publishedAt: new Date() })
              .where(eq(eventOutboxTable.id, row.id));
            processed++;
            span.setAttribute("outbox.outcome", "published");
            span.setStatus("ok");
          } else {
            failed++;
            const nextAttempts = row.attempts + 1;
            const isDead = nextAttempts >= maxAttempts;
            const errMsg = errors.map((e) => e.message).join("; ");
            await tx
              .update(eventOutboxTable)
              .set({
                attempts: nextAttempts,
                lastError: errMsg,
                deadLetter: isDead,
              })
              .where(eq(eventOutboxTable.id, row.id));

            span.setAttribute("outbox.outcome", isDead ? "dead_letter" : "failed");
            span.setStatus("error", errMsg);

            if (isDead) {
              const dlEvent: DeadLetterEvent = {
                id: row.id,
                eventType: row.eventType,
                payload: row.payload as Record<string, unknown>,
                attempts: nextAttempts,
                lastError: errMsg,
              };
              // Log at error level so operators see silent discards in stdout
              // / their log pipeline even if they forgot to wire onDeadLetter.
              log?.error("outbox.dead_letter", {
                id: dlEvent.id,
                eventType: dlEvent.eventType,
                attempts: dlEvent.attempts,
                lastError: dlEvent.lastError,
              });
              if (onDeadLetter) {
                try {
                  await onDeadLetter(dlEvent);
                } catch (hookErr) {
                  log?.error("outbox.dead_letter_hook_failed", {
                    id: dlEvent.id,
                    error: hookErr instanceof Error ? hookErr.message : String(hookErr),
                  });
                }
              }
            }
          }
        } finally {
          span.end();
        }
      }
    });

    return { processed, failed };
  }

  return {
    async start() {
      // skip: already running, idempotent
      if (running) return;
      running = true;

      await subscriberRedis.subscribe(OUTBOX_WAKE_CHANNEL);
      subscriberRedis.on("message", wakeUpListener);

      timer = setInterval(() => {
        void runOnce().catch(() => {
          // skip: see wakeUpListener
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

      subscriberRedis.off("message", wakeUpListener);
      try {
        await subscriberRedis.unsubscribe(OUTBOX_WAKE_CHANNEL);
      } catch {
        // skip: subscriber may already be disconnected during shutdown
      }

      // Drain any in-flight pass so tests + shutdown see consistent state.
      if (passInFlight) {
        await passInFlight.catch(() => {
          // skip: errors were already recorded per-row inside the pass
        });
      }
    },

    runOnce,
  };
}
