import { deleteMany, selectMany, transaction } from "../db/query";
import type { DbConnection } from "../db/connection";
import { eventsTable } from "../event-store";
import { eventConsumerStateTable } from "./event-consumer-state";

// Retention for the events-table. Aggregate events are source of truth —
// they power loadAggregate, projection rebuilds, asOf queries, audit.
// Pruning them is destructive and cannot be reversed, so the caller MUST
// name the aggregateTypes explicitly; there is no default.
//
// Typical use: ops prunes archived aggregate streams (see archive.ts) after
// legal/compliance retention has elapsed, or drops a specific aggregate
// type that's been deprecated and replaced.
//
// Safety guard: before deleting, we check every row in
// `kumiko_event_consumers`. If the minimum `lastProcessedEventId` across
// non-disabled consumers is below the largest event id we'd delete, we
// refuse with ConsumerLagError. A lagging consumer must either catch up,
// be disabled, or the retention call must opt around it; pruning past its
// cursor would silently drop deliveries.
//
// No background scheduler: the framework exposes the function. Ops wires
// it into a cron, BullMQ repeating job, or pg_cron entry — whatever the
// deployment already runs. That keeps the framework dependency-free for
// retention and lets ops reason about timing alongside existing jobs.

export type PruneEventsOptions = {
  // Delete events whose createdAt is strictly older than this.
  // Pass EITHER olderThan (explicit Temporal.Instant) OR olderThanDays.
  readonly olderThan?: Temporal.Instant;
  readonly olderThanDays?: number;
  // Which aggregateTypes to prune. REQUIRED and non-empty. There is no
  // default — pruning the event log is destructive, so the caller has to
  // name what they're destroying.
  readonly aggregateTypes: readonly string[];
  // Dry-run: compute what would be deleted, return count, delete nothing.
  readonly dryRun?: boolean;
};

export type PruneEventsResult = {
  readonly deletedCount: number;
  readonly cutoff: Temporal.Instant;
  readonly aggregateTypes: readonly string[];
  readonly dryRun: boolean;
};

export class ConsumerLagError extends Error {
  constructor(
    readonly laggingConsumer: string,
    readonly consumerCursor: bigint,
    readonly maxCandidateId: bigint,
  ) {
    super(
      `Consumer "${laggingConsumer}" is behind the prune candidates ` +
        `(cursor=${consumerCursor}, max candidate event id=${maxCandidateId}). ` +
        `Pruning would silently drop deliveries. Catch up, disable, or skip the consumer first.`,
    );
    this.name = "ConsumerLagError";
  }
}

function resolveCutoff(opts: PruneEventsOptions): Temporal.Instant {
  if (opts.olderThan) return opts.olderThan;
  const days = opts.olderThanDays;
  if (days === undefined || days <= 0) {
    throw new Error(
      "pruneEvents: pass olderThan (Temporal.Instant) or olderThanDays (positive number).",
    );
  }
  return Temporal.Now.instant().subtract({ hours: days * 24 });
}

export async function pruneEvents(
  db: DbConnection,
  options: PruneEventsOptions,
): Promise<PruneEventsResult> {
  const cutoff = resolveCutoff(options);
  if (!options.aggregateTypes || options.aggregateTypes.length === 0) {
    throw new Error(
      "pruneEvents: aggregateTypes is required and must be non-empty. Pruning the event log is destructive — name the aggregate types to delete explicitly.",
    );
  }
  const aggregateTypes = options.aggregateTypes;
  const dryRun = options.dryRun === true;

  return transaction(db, async (tx) => {
    // Serialise against consumer-bootstrap INSERTs. Without this, the race
    // is: prune reads consumers (snapshot misses a consumer bootstrapping
    // in a parallel tx) → consumer commits its row with
    // lastProcessedEventId=0 → prune deletes events below its new cursor
    // → first pass of the new consumer silently skips the deleted events.
    //
    // SHARE is the lightest table-mode that conflicts with ROW EXCLUSIVE
    // (the mode INSERT/UPDATE/DELETE take). Concurrent INSERTs on the
    // consumer table queue until this TX commits; concurrent UPDATEs
    // (cursor advances) do too, but prune is measured in milliseconds and
    // pausing cursor advances for that window is cheap insurance against
    // a silent data-loss bug.
    await tx.unsafe(`LOCK TABLE "kumiko_event_consumers" IN SHARE MODE`);

    // Step 1 — collect candidate event ids.
    const candidates = await selectMany<{ id: bigint }>(tx, eventsTable, {
      aggregateType: [...aggregateTypes],
      createdAt: { lt: cutoff },
    });

    if (candidates.length === 0) {
      return { deletedCount: 0, cutoff, aggregateTypes, dryRun };
    }

    const maxCandidateId = candidates.reduce(
      (acc, row) => (row.id > acc ? row.id : acc),
      candidates[0]?.id ?? 0n,
    );

    // Step 2 — safety guard: check every ACTIVE consumer has moved past
    // the candidate set. Disabled consumers are intentionally excluded —
    // ops disables them precisely to park them while pruning happens.
    // The SHARE lock above guarantees this SELECT sees a complete view:
    // no new consumer can INSERT a fresh-cursor row between here and the
    // DELETE below.
    const activeConsumers = await selectMany<{
      name: string;
      lastProcessedEventId: bigint;
    }>(tx, eventConsumerStateTable, { status: { ne: "disabled" } });

    for (const consumer of activeConsumers) {
      if (consumer.lastProcessedEventId < maxCandidateId) {
        throw new ConsumerLagError(consumer.name, consumer.lastProcessedEventId, maxCandidateId);
      }
    }

    if (dryRun) {
      return { deletedCount: candidates.length, cutoff, aggregateTypes, dryRun: true };
    }

    // Step 3 — actual delete, bounded to the candidate set.
    const candidateIds = candidates.map((c) => c.id);
    await deleteMany(tx, eventsTable, { id: candidateIds });

    return { deletedCount: candidateIds.length, cutoff, aggregateTypes, dryRun: false };
  });
}
