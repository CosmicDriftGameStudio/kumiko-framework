import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
import type { Logger } from "../logging/types";
import { eventOutboxTable } from "./outbox-table";

// Exported so tests and callers that need the same day-to-ms conversion
// don't re-derive it. Public API is "retention in days" — internally that's
// fixed as 24h * 60m * 60s * 1000ms with no DST adjustment (the threshold
// is a bloat heuristic, not a contractual SLA).
export const DAY_MS = 24 * 60 * 60 * 1000;

export type OutboxCleanupOptions = {
  db: DbConnection;
  // Rows with publishedAt older than this threshold are hard-deleted. These
  // are already-delivered events kept only for debugging; once retention
  // expires, they're pure bloat. Typical: 7.
  publishedRetentionDays: number;
  // Rows flagged dead-letter are kept longer because operators may still
  // want to inspect them for post-mortem. Typical: 90.
  deadLetterRetentionDays: number;
  // How often to run the cleanup when start() is used. Defaults to 1 hour —
  // retention is a slow-moving signal, no need to poll aggressively.
  runIntervalMs?: number;
  log?: Logger;
};

export type OutboxCleanupResult = {
  readonly deletedPublished: number;
  readonly deletedDeadLetter: number;
};

export type OutboxCleanup = {
  start(): Promise<void>;
  stop(): Promise<void>;
  runOnce(): Promise<OutboxCleanupResult>;
};

const DEFAULT_RUN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Retention cleanup for the transactional outbox table.
//
// Two separate thresholds:
//   - publishedRetentionDays: drops delivered rows (publishedAt IS NOT NULL)
//     older than the cutoff. Primary bloat driver.
//   - deadLetterRetentionDays: drops rows that hit maxAttempts and are
//     flagged dead_letter. Kept longer than normal published rows because
//     they're forensic material.
//
// Unpublished non-dead-letter rows (the "still in flight" set) are NEVER
// deleted here, regardless of age. If something's stuck there, that's an
// operational problem the cleanup job must not mask.
//
// start() arms a timer but does NOT trigger an immediate run — the first
// pass happens after runIntervalMs has elapsed. That's intentional: a fresh
// boot on a large pre-existing backlog should not fire a massive DELETE as
// its first act. Operators running a one-off catch-up should call runOnce().
export function createOutboxCleanup(options: OutboxCleanupOptions): OutboxCleanup {
  const {
    db,
    publishedRetentionDays,
    deadLetterRetentionDays,
    runIntervalMs = DEFAULT_RUN_INTERVAL_MS,
    log,
  } = options;

  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // Serialises concurrent runOnce() calls the same way outbox-poller.ts does:
  // if a pass is already in flight, callers get the same promise back rather
  // than spawning a parallel DELETE.
  let passInFlight: Promise<OutboxCleanupResult> | null = null;

  async function doPass(): Promise<OutboxCleanupResult> {
    const now = Date.now();
    const publishedCutoff = new Date(now - publishedRetentionDays * DAY_MS);
    const deadLetterCutoff = new Date(now - deadLetterRetentionDays * DAY_MS);

    const publishedDel = await db
      .delete(eventOutboxTable)
      .where(
        and(
          isNotNull(eventOutboxTable.publishedAt),
          lt(eventOutboxTable.publishedAt, publishedCutoff),
        ),
      )
      .returning({ id: eventOutboxTable.id });

    const deadDel = await db
      .delete(eventOutboxTable)
      .where(
        and(
          eq(eventOutboxTable.deadLetter, true),
          lt(eventOutboxTable.createdAt, deadLetterCutoff),
        ),
      )
      .returning({ id: eventOutboxTable.id });

    const result: OutboxCleanupResult = {
      deletedPublished: publishedDel.length,
      deletedDeadLetter: deadDel.length,
    };

    if (result.deletedPublished > 0 || result.deletedDeadLetter > 0) {
      log?.info("outbox.cleanup", {
        deletedPublished: result.deletedPublished,
        deletedDeadLetter: result.deletedDeadLetter,
      });
    }

    return result;
  }

  async function runOnce(): Promise<OutboxCleanupResult> {
    if (passInFlight) return passInFlight;
    passInFlight = doPass();
    try {
      return await passInFlight;
    } finally {
      passInFlight = null;
    }
  }

  return {
    async start() {
      // skip: already running, idempotent
      if (running) return;
      running = true;
      timer = setInterval(() => {
        void runOnce().catch((err) => {
          log?.error("outbox.cleanup_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, runIntervalMs);
    },

    async stop() {
      // skip: already stopped, idempotent
      if (!running) return;
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (passInFlight) {
        await passInFlight.catch(() => {
          // skip: errors already logged inside runOnce
        });
      }
    },

    runOnce,
  };
}
