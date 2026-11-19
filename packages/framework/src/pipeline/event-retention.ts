/// <reference types="temporal-polyfill/global" preserve="true" />

import type { DbConnection } from "../db/connection.ts";
import { lockEventConsumersShareMode } from "../db/queries/event-consumer.ts";
import { selectExpiredStreamEventIds } from "../db/queries/event-store.ts";
import { deleteMany, selectMany, transaction } from "../db/query.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import type { Registry } from "../engine/types/index.ts";
import { eventsTable } from "../event-store/index.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { eventConsumerStateTable } from "./event-consumer-state.ts";
import {
  isRegistryShapedConsumerName,
  registryDeclaredConsumerNames,
} from "./registry-consumer-names.ts";

const log = createFallbackLogger("event-retention");

// The registry belongs to the process running retention; another process (a worker composed
// differently, an old pod mid-rollout) may still drive a consumer this one does not declare. Every
// pass that delivers or fails writes updated_at, so only a row that stood still this long counts as
// abandoned. Seven days lies well above a rollout (minutes to hours) and an outage over a long
// weekend; a caught-up idle consumer does not block pruning anyway, so its still updated_at is moot.
const UNDECLARED_CONSUMER_ABANDONED_AFTER_DAYS = 7;

// Retention for the events-table. Aggregate events are source of truth —
// they power loadAggregate, projection rebuilds, asOf queries, audit.
// Pruning them is destructive and cannot be reversed, so the caller MUST
// name the aggregateTypes explicitly; there is no default.
//
// Typical use: ops prunes archived aggregate streams (see archive.ts) after
// legal/compliance retention has elapsed, or drops a specific aggregate
// type that's been deprecated and replaced.
//
// Only whole streams are pruned: a stream (tenant, aggregate id) goes when its newest event is
// older than the cutoff, and then with all of its events, so rebuilds never see a stream
// without its created event.
//
// Safety guard: before deleting, we check every row in
// `kumiko_event_consumers`. If the minimum `lastProcessedEventId` across
// non-disabled consumers is below the largest event id we'd delete, we
// refuse with ConsumerLagError. A lagging consumer must either catch up,
// be disabled, or the retention call must opt around it; pruning past its
// cursor would silently drop deliveries. With `registry`, rows of projection
// and catch-up-job consumers the app no longer declares are skipped once they
// have not moved for UNDECLARED_CONSUMER_ABANDONED_AFTER_DAYS: nothing advances
// them, so they would block retention forever.
//
// No background scheduler: the framework exposes the function. Ops wires
// it into a cron, BullMQ repeating job, or pg_cron entry — whatever the
// deployment already runs. That keeps the framework dependency-free for
// retention and lets ops reason about timing alongside existing jobs.

export type PruneEventsOptions = {
  // Delete all events of streams whose newest event is strictly older than this.
  // Pass EITHER olderThan (explicit Temporal.Instant) OR olderThanDays.
  readonly olderThan?: Temporal.Instant;
  readonly olderThanDays?: number;
  // Which aggregateTypes to prune. REQUIRED and non-empty. There is no
  // default — pruning the event log is destructive, so the caller has to
  // name what they're destroying.
  readonly aggregateTypes: readonly string[];
  // Optional: restrict candidates to these aggregate ids. Non-empty when set.
  readonly aggregateIds?: readonly string[];
  // Dry-run: compute what would be deleted, return count, delete nothing.
  readonly dryRun?: boolean;
  // Delete at most this many whole streams (lowest first event id first) per call. deletedCount
  // counts events and can exceed batchSize. Callers with a large backlog loop until
  // deletedCount < batchSize, which terminates because deletedCount >= number of streams.
  readonly batchSize?: number;
  // The app's full registry, not one process's consumer list: a worker that runs a subset of the
  // consumers must not treat the others as stale. Without it every non-disabled row counts.
  readonly registry?: Registry;
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
  return runInSystemRowLevelSecurityScope(
    "event retention pruning deletes expired events of all tenants",
    async () => {
      const cutoff = resolveCutoff(options);
      if (!options.aggregateTypes || options.aggregateTypes.length === 0) {
        throw new Error(
          "pruneEvents: aggregateTypes is required and must be non-empty. Pruning the event log is destructive — name the aggregate types to delete explicitly.",
        );
      }
      if (options.aggregateIds !== undefined && options.aggregateIds.length === 0) {
        throw new Error("pruneEvents: aggregateIds must be non-empty when set.");
      }
      if (
        options.batchSize !== undefined &&
        (!Number.isInteger(options.batchSize) || options.batchSize < 1)
      ) {
        throw new Error("pruneEvents: batchSize must be a positive integer.");
      }
      const aggregateTypes = options.aggregateTypes;
      const aggregateIds = options.aggregateIds;
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
        await lockEventConsumersShareMode(tx);

        // Step 1 — collect candidate event ids of fully expired streams.
        const candidateIds = await selectExpiredStreamEventIds(tx, {
          aggregateTypes,
          ...(aggregateIds ? { aggregateIds } : {}),
          cutoff,
          ...(options.batchSize === undefined ? {} : { streamLimit: options.batchSize }),
        });

        if (candidateIds.length === 0) {
          return { deletedCount: 0, cutoff, aggregateTypes, dryRun };
        }

        const maxCandidateId = candidateIds.reduce(
          // biome-ignore lint/complexity/useMathMinMax: ids are bigint, Math.max throws a TypeError on BigInt
          (acc, id) => (id > acc ? id : acc),
          candidateIds[0] ?? 0n,
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
          updatedAt: Temporal.Instant;
        }>(tx, eventConsumerStateTable, { status: { ne: "disabled" } });

        const declaredConsumerNames = options.registry
          ? registryDeclaredConsumerNames(options.registry)
          : undefined;
        const abandonedBefore = Temporal.Now.instant().subtract({
          hours: UNDECLARED_CONSUMER_ABANDONED_AFTER_DAYS * 24,
        });
        const skippedConsumerNames = new Set<string>();
        for (const consumer of activeConsumers) {
          if (
            declaredConsumerNames &&
            isRegistryShapedConsumerName(consumer.name) &&
            !declaredConsumerNames.has(consumer.name) &&
            Temporal.Instant.compare(consumer.updatedAt, abandonedBefore) < 0
          ) {
            skippedConsumerNames.add(consumer.name);
            continue;
          }
          if (consumer.lastProcessedEventId < maxCandidateId) {
            throw new ConsumerLagError(
              consumer.name,
              consumer.lastProcessedEventId,
              maxCandidateId,
            );
          }
        }
        if (skippedConsumerNames.size > 0) {
          log.warn("pruneEvents skipped consumers the registry no longer declares", {
            consumers: [...skippedConsumerNames],
          });
        }

        if (dryRun) {
          return { deletedCount: candidateIds.length, cutoff, aggregateTypes, dryRun: true };
        }

        // Step 3 — actual delete, bounded to the candidate set.
        await deleteMany(tx, eventsTable, { id: candidateIds });

        return { deletedCount: candidateIds.length, cutoff, aggregateTypes, dryRun: false };
      });
    },
  );
}
