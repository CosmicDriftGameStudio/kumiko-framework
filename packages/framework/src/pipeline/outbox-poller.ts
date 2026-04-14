import { and, asc, eq, isNull } from "drizzle-orm";
import type Redis from "ioredis";
import type { DbConnection } from "../db/connection";
import type { BrokerEvent, EventBroker } from "./event-broker";
import { eventOutboxTable, OUTBOX_WAKE_CHANNEL } from "./outbox-table";

export type OutboxPollerOptions = {
  db: DbConnection;
  // Subscriber instance — needed because ioredis clients in subscribe mode
  // can't issue other commands. The publisher + wake-up uses a separate conn.
  subscriberRedis: Redis;
  eventBroker: EventBroker;
  batchSize?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
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
  } = options;

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
        })
        .from(eventOutboxTable)
        .where(and(isNull(eventOutboxTable.publishedAt), eq(eventOutboxTable.deadLetter, false)))
        .orderBy(asc(eventOutboxTable.createdAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });

      for (const row of rows) {
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
