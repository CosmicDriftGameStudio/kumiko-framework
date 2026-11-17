import type { StoredEvent } from "@cosmicdrift/kumiko-types/event-store-types";
import type { DbRunner } from "../db/index.ts";
import { isUniqueViolation } from "../db/pg-error.ts";
import {
  claimXactId,
  insertEventRowsBatch,
  notifyPgChannel,
  runAtomicEventWrite,
  selectStreamMaxVersions,
} from "../db/queries/event-store.ts";
import { InternalError } from "../errors/index.ts";
import { VersionConflictError } from "./errors.ts";
import {
  append,
  buildStoredEvent,
  type EventToAppend,
  EVENTS_PUBSUB_CHANNEL,
  insertReturnOf,
  mapAppendUniqueViolation,
  prepareEventForStore,
} from "./event-store.ts";
import { currentSeedCreatedAt } from "./seed-clock.ts";
import { inEventStreamScope } from "./stream-scope.ts";

function assertBatchShape(events: readonly EventToAppend[]): void {
  const tenantId = events[0]?.tenantId;
  const seen = new Set<string>();
  for (const event of events) {
    if (event.tenantId !== tenantId) {
      throw new InternalError({ message: "appendMany: all events must share one tenantId" });
    }
    if (seen.has(event.aggregateId)) {
      throw new InternalError({
        message: `appendMany: aggregate ${event.aggregateId} appears more than once`,
      });
    }
    seen.add(event.aggregateId);
  }
}

// All or nothing: a missing row throws before the caller's savepoint or transaction commits.
export async function appendMany(
  db: DbRunner,
  events: readonly EventToAppend[],
): Promise<readonly StoredEvent[]> {
  const first = events[0];
  if (first === undefined) return [];
  assertBatchShape(events);

  // Seed back-dating needs the per-event predecessor time check of append(), and seeds are
  // rare and small.
  if (currentSeedCreatedAt() !== undefined) {
    const stored: StoredEvent[] = [];
    for (const event of events) stored.push(await append(db, event));
    return stored;
  }

  const prepared = await Promise.all(events.map(prepareEventForStore));
  const tenantId = first.tenantId;
  try {
    const rows = await inEventStreamScope(tenantId, () =>
      runAtomicEventWrite(db, async (runner) => {
        await claimXactId(runner);
        const inserted = await insertEventRowsBatch(
          runner,
          prepared.map((event) => ({
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
            tenantId: event.tenantId,
            newVersion: event.expectedVersion + 1,
            type: event.type,
            eventVersion: event.eventVersion ?? 1,
            payload: event.payload,
            metadata: event.metadata,
            createdBy: event.metadata.userId,
            expectedVersion: event.expectedVersion,
          })),
        );
        const byAggregate = new Map(inserted.map((row) => [row.aggregate_id, row]));
        const missing = prepared.filter((event) => !byAggregate.has(event.aggregateId));
        const firstMissing = missing[0];
        if (firstMissing !== undefined) {
          const versions = await selectStreamMaxVersions(
            runner,
            missing.map((event) => event.aggregateId),
            tenantId,
          );
          throw new VersionConflictError(
            firstMissing.aggregateId,
            firstMissing.expectedVersion,
            versions.get(firstMissing.aggregateId) ?? 0,
          );
        }
        await notifyPgChannel(runner, EVENTS_PUBSUB_CHANNEL);
        return byAggregate;
      }),
    );
    return prepared.map((event) => {
      const row = rows.get(event.aggregateId);
      if (row === undefined) {
        throw new InternalError({ message: `appendMany: no row for ${event.aggregateId}` });
      }
      return buildStoredEvent(
        event,
        event.expectedVersion + 1,
        event.eventVersion ?? 1,
        insertReturnOf(row),
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const withIdempotencyKey = events.find((event) => event.metadata.idempotencyKey);
      throw mapAppendUniqueViolation(e, withIdempotencyKey ?? first);
    }
    throw e;
  }
}
