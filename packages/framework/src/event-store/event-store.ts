/// <reference types="temporal-polyfill/global" preserve="true" />
import {
  type EventMetadata,
  isPersonalDataGated,
  type StoredEvent,
  UNATTRIBUTED_ORIGIN,
} from "@cosmicdrift/kumiko-types/event-store-types";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { requestContext } from "../api/request-context.ts";

import { encryptEventPayloadPii } from "../crypto/event-pii.ts";
import { instantToTimestamptzParam } from "../db/driver-value-preparation.ts";
import type { DbRunner } from "../db/index.ts";
import { constraintOf, isUniqueViolation } from "../db/pg-error.ts";
import {
  claimXactId,
  insertFirstEventRow,
  insertSubsequentEventRow,
  notifyPgChannel,
  runAtomicEventWrite,
  type SubsequentEventInsertRow,
  selectAggregateMaxVersion,
  selectEventsHighWaterMark,
  selectStreamMaxVersion,
  selectStreamMaxVersions,
} from "../db/queries/event-store.ts";
import { selectMany } from "../db/query.ts";
import type { TenantId } from "../engine/types/index.ts";
import { isStreamArchived } from "./archive.ts";
import {
  IdempotentAppendConflictError,
  SeedTimeOrderError,
  VersionConflictError,
} from "./errors.ts";
import { eventsTable } from "./events-schema.ts";
import { toStoredEvent } from "./row-to-stored-event.ts";
import { currentSeedCreatedAt } from "./seed-clock.ts";
import { inEventStreamScope } from "./stream-scope.ts";

export type { EventMetadata, StoredEvent } from "@cosmicdrift/kumiko-types/event-store-types";

export type EventToAppend = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  // Predecessor version. 0 for a brand-new aggregate — framework writes version 1.
  readonly expectedVersion: number;
  readonly type: string;
  readonly eventVersion?: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: EventMetadata;
};

type SelectedEvent = {
  readonly id: bigint;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  readonly version: number;
  readonly type: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: EventMetadata;
  readonly createdAt: Temporal.Instant;
  readonly createdBy: string;
};

// Append one event atomically. Two guarantees combined:
//
//   1. UNIQUE (tenant_id, aggregate_id, version) serializes concurrent writers
//      within a tenant. A second writer racing the same expectedVersion hits
//      ON CONFLICT DO NOTHING (no row), then the stream version is read inside
//      the still-intact transaction → VersionConflictError. That relies on
//      READ COMMITTED; REPEATABLE READ/SERIALIZABLE raise 40001 instead. Only
//      the idempotency index still raises 23505.
//      Cross-tenant aggregate_id collisions are not conflicts by definition:
//      two tenants owning a row with the same UUID is just isolation, not a
//      race.
//
//   2. For updates (expectedVersion > 0), INSERT … SELECT … WHERE EXISTS
//      requires the predecessor event to exist within the same tenant — i.e.
//      "you can't append v6 to a stream whose v5 was never written." The
//      tenant filter inside the EXISTS is belt-and-suspenders now that the
//      unique index carries tenant_id; we keep it so the predecessor check
//      stays semantically obvious when read in isolation.
//
// Creates (expectedVersion === 0) skip the predecessor check — no predecessor
// exists yet. Colliding creates fall out via the same index (tenant_id, aggregate_id, version=1).
// Channel name used by append() → NOTIFY and the event-dispatcher → LISTEN
// (Sprint E.4). The event-dispatcher subscribes to this channel on start and
// fires a runOnce immediately on each commit, so delivery latency is bounded
// by TCP round-trip instead of pollIntervalMs.
export const EVENTS_PUBSUB_CHANNEL = "kumiko_events_new";

export async function append(db: DbRunner, event: EventToAppend): Promise<StoredEvent> {
  // Event-PII: stored payload AND returned echo carry ciphertext, so
  // inline projections and rebuilds materialize identical rows.
  const payload = await encryptEventPayloadPii(event.type, event.payload, {
    tenantId: event.tenantId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
  });
  const toStore = stampOrigin(payload === event.payload ? event : { ...event, payload });
  const seedCreatedAt = currentSeedCreatedAt();
  const newVersion = toStore.expectedVersion + 1;
  const eventVersion = toStore.eventVersion ?? 1;

  try {
    const row = await inEventStreamScope(toStore.tenantId, () =>
      runAtomicEventWrite(db, async (runner) => {
        await claimXactId(runner);
        // Inside the write transaction so a concurrent live append cannot slip
        // between the check and the insert.
        if (seedCreatedAt !== undefined && toStore.expectedVersion > 0) {
          await assertSeedTimeNotBeforePredecessor(runner, toStore, seedCreatedAt);
        }
        const inserted =
          toStore.expectedVersion === 0
            ? await insertFirstEvent(runner, toStore, newVersion, eventVersion, seedCreatedAt)
            : await insertSubsequentEvent(runner, toStore, newVersion, eventVersion, seedCreatedAt);
        // NOTIFY after the INSERT and inside the same transaction: PG delivers it on
        // commit, so the dispatcher cannot wake before the row is visible.
        await notifyPgChannel(runner, EVENTS_PUBSUB_CHANNEL);
        return inserted;
      }),
    );

    return buildStoredEvent(toStore, newVersion, eventVersion, row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      // The version index normally never throws (ON CONFLICT DO NOTHING); it
      // only lands here for an unknown or renamed constraint.
      // Two unique constraints on this table: events_aggregate_version_uq
      // (tenant_id, aggregate_id, version) — a concurrent writer won the
      // race to the next version — and events_idempotency_uq (tenant_id,
      // metadata->>'idempotencyKey') — the caller reused an idempotency key.
      // constraintOf() tells them apart; unknown/renamed constraint falls
      // back to VersionConflictError, the pre-existing behaviour.
      if (constraintOf(e) === "events_idempotency_uq" && event.metadata.idempotencyKey) {
        throw new IdempotentAppendConflictError(event.tenantId, event.metadata.idempotencyKey);
      }
      throw new VersionConflictError(event.aggregateId, event.expectedVersion);
    }
    throw e;
  }
}

// Attribution is derived from the execution scope, never taken from
// the caller: a passed-in value can lie about who wrote the row, a derived
// one cannot. Hence overwrite rather than merge. appendRaw/appendRawBatch
// bypass this deliberately — they replay historical rows verbatim.
function stampOrigin(event: EventToAppend): EventToAppend {
  const origin = requestContext.get();
  const { writeOrigin: _droppedCallerWriteOrigin, ...restMetadata } = event.metadata;
  return {
    ...event,
    metadata: {
      ...restMetadata,
      feature: origin?.feature ?? UNATTRIBUTED_ORIGIN,
      handler: origin?.handler ?? UNATTRIBUTED_ORIGIN,
      ...(origin?.writeOrigin &&
        isPersonalDataGated(origin.writeOrigin) && { writeOrigin: origin.writeOrigin }),
    },
  };
}

// loadAggregateAsOf and projection rebuilds order by created_at, so a stream
// whose versions go backwards in time would read and replay wrongly.
async function assertSeedTimeNotBeforePredecessor(
  db: DbRunner,
  event: EventToAppend,
  seedCreatedAt: Temporal.Instant,
): Promise<void> {
  const [predecessor] = await selectMany<{ createdAt: Temporal.Instant }>(db, eventsTable, {
    aggregateId: event.aggregateId,
    tenantId: event.tenantId,
    version: event.expectedVersion,
  });
  if (predecessor && predecessor.createdAt.epochMilliseconds > seedCreatedAt.epochMilliseconds) {
    throw new SeedTimeOrderError(
      event.aggregateType,
      event.aggregateId,
      event.expectedVersion + 1,
      seedCreatedAt,
      predecessor.createdAt,
    );
  }
}

type InsertReturn = { id: bigint; createdAt: Temporal.Instant };

async function insertFirstEvent(
  db: DbRunner,
  event: EventToAppend,
  newVersion: number,
  eventVersion: number,
  seedCreatedAt: Temporal.Instant | undefined,
): Promise<InsertReturn> {
  const row = await insertFirstEventRow(db, {
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    newVersion,
    type: event.type,
    eventVersion,
    payload: event.payload,
    metadata: event.metadata,
    createdBy: event.metadata.userId,
    createdAt: seedCreatedAt && instantToTimestamptzParam(seedCreatedAt),
  });
  if (!row) throw await versionConflictWithCurrentVersion(db, event);
  return insertReturnOf(row);
}

// Subsequent event — predecessor must exist AND belong to the same tenant.
// INSERT … SELECT … WHERE EXISTS is awkward in the typed builder, so this
// one stays raw. Uses ${eventsTable} for the table reference so renames
// don't silently break the statement.
async function insertSubsequentEvent(
  db: DbRunner,
  event: EventToAppend,
  newVersion: number,
  eventVersion: number,
  seedCreatedAt: Temporal.Instant | undefined,
): Promise<InsertReturn> {
  const row = await insertSubsequentEventRow(db, {
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    newVersion,
    type: event.type,
    eventVersion,
    payload: event.payload,
    metadata: event.metadata,
    createdBy: event.metadata.userId,
    expectedVersion: event.expectedVersion,
    createdAt: seedCreatedAt && instantToTimestamptzParam(seedCreatedAt),
  });
  if (!row) throw await versionConflictWithCurrentVersion(db, event);
  return insertReturnOf(row);
}

function insertReturnOf(row: SubsequentEventInsertRow): InsertReturn {
  const createdAt =
    row.created_at instanceof Date
      ? Temporal.Instant.fromEpochMilliseconds(row.created_at.getTime())
      : Temporal.Instant.from(row.created_at);
  return {
    id: typeof row.id === "bigint" ? row.id : BigInt(row.id),
    createdAt,
  };
}

// Runs in the still-healthy write transaction: ON CONFLICT DO NOTHING left it
// unaborted, so the stream version is readable here.
async function versionConflictWithCurrentVersion(
  db: DbRunner,
  event: EventToAppend,
): Promise<VersionConflictError> {
  const currentVersion = await selectStreamMaxVersion(db, event.aggregateId, event.tenantId);
  return new VersionConflictError(event.aggregateId, event.expectedVersion, currentVersion);
}

function buildStoredEvent(
  event: EventToAppend,
  newVersion: number,
  eventVersion: number,
  row: InsertReturn,
): StoredEvent {
  return {
    id: String(row.id),
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    version: newVersion,
    type: event.type,
    eventVersion,
    payload: event.payload,
    metadata: event.metadata,
    createdAt: row.createdAt,
    createdBy: event.metadata.userId,
  };
}

// Load all events for an aggregate, ordered by version. Tenant check is
// belt + suspenders: even if a caller passes a correct aggregate_id by
// mistake, the tenant filter prevents cross-tenant reads.
//
// Archived streams return an empty slice by default. Pass
// { includeArchived: true } for ops tools / audit that must see the tail
// of an archived aggregate. The archive check is a single indexed lookup —
// negligible on the hot path.
//
// { aggregateType } is opt-in: without it, a stream is loaded by
// aggregateId alone, matching prior behavior. Callers that share id
// generation across multiple aggregate types on the same id (e.g. a solon-
// style collision) must pass it to avoid folding a foreign type's events
// into the loaded stream. The aggregateType condition stays an unindexed
// post-filter on purpose: events_aggregate_version_uq already narrows the scan
// to one aggregate's rows, so an index including aggregate_type would only add
// write cost.
export async function loadAggregate(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
  options?: {
    readonly includeArchived?: boolean;
    readonly aggregateType?: string;
    // Point read of one event of the stream instead of the whole stream.
    readonly atVersion?: number;
  },
): Promise<readonly StoredEvent[]> {
  // "" must not fall through to the unfiltered load: a dynamically computed
  // type that came out empty would silently fold in foreign aggregate types.
  if (options?.aggregateType === "") {
    throw new Error("loadAggregate: aggregateType must be a non-empty string when provided");
  }
  return inEventStreamScope(tenantId, async () => {
    if (!options?.includeArchived) {
      const archived = await isStreamArchived(db, tenantId, aggregateId);
      if (archived) return [];
    }
    const rows = await selectMany<SelectedEvent>(
      db,
      eventsTable,
      {
        aggregateId,
        tenantId,
        ...(options?.aggregateType !== undefined && { aggregateType: options.aggregateType }),
        ...(options?.atVersion !== undefined && { version: options.atVersion }),
      },
      { orderBy: { col: "version", direction: "asc" } },
    );
    return rows.map(toStoredEvent);
  });
}

// Events and the stream's latest version from ONE read, so both come from the same
// snapshot: a commit landing between two separate statements would leave the caller
// pinning a version its loaded events never covered. The aggregateType filter is applied
// after the read because a foreign type sharing the aggregateId still occupies versions
// the next append has to stack on. Archived streams load empty but keep their real version.
export async function loadAggregateForWriting(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
  options: { readonly aggregateType: string },
): Promise<{ readonly events: readonly StoredEvent[]; readonly streamVersion: number }> {
  if (options.aggregateType === "") {
    throw new Error("loadAggregateForWriting: aggregateType must be a non-empty string");
  }
  return inEventStreamScope(tenantId, async () => {
    if (await isStreamArchived(db, tenantId, aggregateId)) {
      return { events: [], streamVersion: await getStreamVersion(db, aggregateId, tenantId) };
    }
    const rows = await selectMany<SelectedEvent>(
      db,
      eventsTable,
      { aggregateId, tenantId },
      { orderBy: { col: "version", direction: "asc" } },
    );
    const all = rows.map(toStoredEvent);
    return {
      events: all.filter((e) => e.aggregateType === options.aggregateType),
      streamVersion: all.at(-1)?.version ?? 0,
    };
  });
}

// Load events up to a point in time. Used for asOf queries that reconstruct
// historical state. Includes events whose created_at is <= asOf. Same
// archive semantics as loadAggregate.
export async function loadAggregateAsOf(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
  asOf: Temporal.Instant,
  options?: { readonly includeArchived?: boolean },
): Promise<readonly StoredEvent[]> {
  return inEventStreamScope(tenantId, async () => {
    if (!options?.includeArchived) {
      const archived = await isStreamArchived(db, tenantId, aggregateId);
      if (archived) return [];
    }
    const rows = await selectMany<SelectedEvent>(
      db,
      eventsTable,
      { aggregateId, tenantId, createdAt: { lte: asOf } },
      { orderBy: { col: "version", direction: "asc" } },
    );
    return rows.map(toStoredEvent);
  });
}

// Cheapest possible read of "what's the latest version on this stream?". The
// CRUD executor uses this as expectedVersion for its append, so a domain
// event appended via ctx.appendEvent between two CRUD writes doesn't cause
// the next CRUD write to fail with version_conflict. Indexed lookup on the
// existing (aggregate_id, version) unique index. Returns 0 for empty/unknown
// streams (matches create()'s expectedVersion=0 convention).
// @wrapper-known semantic-alias
export async function getStreamVersion(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
): Promise<number> {
  return inEventStreamScope(tenantId, () => selectStreamMaxVersion(db, aggregateId, tenantId));
}

export async function getStreamVersions(
  db: DbRunner,
  aggregateIds: readonly string[],
  tenantId: TenantId,
): Promise<Map<string, number>> {
  return inEventStreamScope(tenantId, () => selectStreamMaxVersions(db, aggregateIds, tenantId));
}

/** MAX(version) for one aggregate — no tenant filter. SECURITY: existence-oracle,
 *  a caller can probe whether an aggregateId has any events regardless of tenant
 *  membership. Only call from seed/system-internal paths (idempotency checks
 *  against a known aggregateId) — never from a handler reachable with
 *  caller-controlled input. */
// @wrapper-known semantic-alias
export async function getUnscopedAggregateStreamMaxVersion(
  db: DbRunner,
  aggregateId: string,
): Promise<number> {
  return selectAggregateMaxVersion(db, aggregateId);
}

// Global high-water-mark = MAX(events.id). Marten/Wolverine standard for
// projection/consumer lag math: lag = HWM - cursor. Single-row aggregate over
// the bigserial PK index — sub-millisecond cost. Returns 0n on an empty log
// (boot, fresh tenant, post-archive).
// @wrapper-known semantic-alias
/** Seed/orphan helper — prefer this over importing the restricted existence-oracle by name. */
export async function getUnscopedStreamMaxVersionForSeed(
  ...args: Parameters<typeof getUnscopedAggregateStreamMaxVersion>
): ReturnType<typeof getUnscopedAggregateStreamMaxVersion> {
  return getUnscopedAggregateStreamMaxVersion(...args);
}

export async function getEventsHighWaterMark(db: DbRunner): Promise<bigint> {
  return selectEventsHighWaterMark(db);
}

// Load events strictly newer than a given version. Used by snapshot-aware
// reads: snapshot provides state up to version N, apply events v > N to
// catch up to current.
export async function loadEventsAfterVersion(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
  afterVersion: number,
): Promise<readonly StoredEvent[]> {
  const rows = await selectMany<SelectedEvent>(
    db,
    eventsTable,
    { aggregateId, tenantId, version: { gt: afterVersion } },
    { orderBy: { col: "version", direction: "asc" } },
  );
  return rows.map(toStoredEvent);
}

// Stream every event for an aggregate_type across all tenants, batchwise
// instead of buffered. Memory-bounded: never more than `batchSize` rows
// resident. Cursor walks `events.id` (bigserial monotonic, but ids are
// assigned at INSERT time, not commit time — a sweep can overtake a still-
// open transaction and its lower id, same gap the event-dispatcher's
// pending_gaps tracks). Fine for this generator's use case: history sweeps
// (projection-rebuild, tests) that don't need live, just-committed rows.
//
// Use case: projection-rebuild on a large event log (>100k events per
// aggregate-type); the caller accumulates only what it needs.
//
// Default batchSize 1000 — trade-off between DB round-trips (smaller =
// more queries) and memory (larger = more resident).
//
// The caller may pause / do async work between yields; the next batch is
// only fetched when consumed.
//
// Cancellation: pass `signal` (typically `ctx.signal` from a handler) to
// abort iteration. Checked both at batch boundaries (before the next
// fetch) AND between yields (so abort lands within one event regardless
// of batch size). Throws AbortError on the first check after abort;
// in-flight queries are not actively cancelled (connection
// cancel is a separate, riskier concern handled per-query at the TenantDb
// boundary).
export async function* streamAllEventsByType(
  db: DbRunner,
  aggregateType: string,
  batchSize = 1000,
  signal?: AbortSignal,
): AsyncIterable<StoredEvent> {
  let cursorId = 0n;
  while (true) {
    signal?.throwIfAborted();
    const rows = await selectMany<SelectedEvent>(
      db,
      eventsTable,
      { aggregateType, id: { gt: cursorId } },
      { orderBy: { col: "id", direction: "asc" }, limit: batchSize },
    );

    if (rows.length === 0) {
      // skip: end of stream — generator exit is the natural termination.
      return;
    }

    // Track the highest id seen in this batch as we yield. Avoids both the
    // non-null assertion and a redundant array index — the cursor falls out
    // of the same loop that produces the events.
    let nextCursor = cursorId;
    for (const row of rows) {
      // Per-yield abort check. Cheap (one boolean read), keeps cancel
      // semantics independent of the batchSize knob — at batchSize=1000
      // a batch-boundary-only check would still yield 1000 events after
      // an abort which isn't what callers expect.
      signal?.throwIfAborted();
      yield toStoredEvent(row);
      nextCursor = row.id;
    }
    cursorId = nextCursor;
  }
}
