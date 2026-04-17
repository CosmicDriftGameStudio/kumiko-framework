import { and, getTableName, inArray, lt, sql } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
import { eventsTable } from "../event-store";
import { eventConsumerStateTable } from "./event-consumer-state";

// Retention for the events-table. Two principles:
//
//   1. **Aggregate events are source of truth and are never pruned by
//      default.** They power loadAggregate, projection rebuilds, asOf
//      queries, audit. Deleting them breaks those guarantees irreversibly.
//
//   2. **Pub/sub events (aggregateType = "pubsub") are transient by design
//      — r.postEvent-subscribers react and move on. They can be pruned
//      safely once every interested consumer has advanced past them.
//
// The default caller-facing call (`pruneEvents(db, { olderThanDays: N })`)
// prunes ONLY pubsub events. To prune something else, the caller passes
// an explicit aggregateTypes list — and owns the consequences.
//
// Safety guard: before deleting, we check every row in
// `kumiko_event_consumers`. If the minimum `lastProcessedEventId` across
// non-disabled consumers is below the largest event id we'd delete, we
// refuse. A lagging consumer must either catch up, be disabled, or be
// explicitly skipped; pruning past its cursor would silently drop
// deliveries.
//
// No background scheduler: the framework exposes the function. Ops wires
// it into a cron, BullMQ repeating job, or pg_cron entry — whatever the
// deployment already runs. That keeps the framework dependency-free for
// retention and lets ops reason about timing alongside existing jobs.

// Synthetic aggregate-type for pub/sub events. Pub/sub is messaging, not
// event-sourcing — there is no real aggregate, no replay, no ordering
// guarantee per aggregate-id. But the pub/sub events share the same
// events-table as aggregate events so the dispatcher has one ordered log
// to walk (and retention has one place to prune).
//
// To satisfy `unique(aggregate_id, version)` on the events table, each
// ctx.emit allocates a fresh UUID as aggregateId and uses version = 1.
// The (aggregateType = "pubsub") discriminator is how consumers and the
// retention guard tell pub/sub apart from aggregate streams. Renaming
// this string is a schema migration — existing rows in prod would become
// unreachable by aggregateType filter.
export const PUBSUB_AGGREGATE_TYPE = "pubsub";

export type PruneEventsOptions = {
  // Delete events whose createdAt is strictly older than this.
  // Pass EITHER olderThan (explicit Date) OR olderThanDays (convenience).
  readonly olderThan?: Date;
  readonly olderThanDays?: number;
  // Which aggregateTypes to consider. Default: [PUBSUB_AGGREGATE_TYPE].
  // Callers that want to prune aggregate event types must opt in
  // explicitly — this is destructive and cannot be reversed.
  readonly aggregateTypes?: readonly string[];
  // Dry-run: compute what would be deleted, return count, delete nothing.
  readonly dryRun?: boolean;
};

export type PruneEventsResult = {
  readonly deletedCount: number;
  readonly cutoff: Date;
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

function resolveCutoff(opts: PruneEventsOptions): Date {
  if (opts.olderThan) return opts.olderThan;
  const days = opts.olderThanDays;
  if (days === undefined || days <= 0) {
    throw new Error("pruneEvents: pass olderThan (Date) or olderThanDays (positive number).");
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function pruneEvents(
  db: DbConnection,
  options: PruneEventsOptions,
): Promise<PruneEventsResult> {
  const cutoff = resolveCutoff(options);
  const aggregateTypes = options.aggregateTypes ?? [PUBSUB_AGGREGATE_TYPE];
  const dryRun = options.dryRun === true;

  return db.transaction(async (tx) => {
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
    //
    // Drizzle can't express LOCK TABLE — drop to raw SQL with the table
    // name identifier so a future table-rename is caught at compile time.
    await tx.execute(sql.raw(`LOCK TABLE ${getTableName(eventConsumerStateTable)} IN SHARE MODE`));

    // Step 1 — collect candidate event ids.
    const candidates = await tx
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          inArray(eventsTable.aggregateType, [...aggregateTypes]),
          lt(eventsTable.createdAt, cutoff),
        ),
      );

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
    const activeConsumers = await tx
      .select()
      .from(eventConsumerStateTable)
      .where(sql`${eventConsumerStateTable.status} <> 'disabled'`);

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
    const deleted = await tx
      .delete(eventsTable)
      .where(inArray(eventsTable.id, candidateIds))
      .returning({ id: eventsTable.id });

    return { deletedCount: deleted.length, cutoff, aggregateTypes, dryRun: false };
  });
}
