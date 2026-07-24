import type { EventMetadata, StoredEvent } from "@cosmicdrift/kumiko-types/event-store-types";
import { encryptEventPayloadPii } from "../crypto/event-pii";
import type { DbRunner } from "../db";
import { constraintOf, isUniqueViolation } from "../db/pg-error";
import {
  insertSubsequentEventRow,
  notifyPgChannel,
  selectAggregateMaxVersion,
  selectAggregateStreamTenant,
  selectEventsHighWaterMark,
  selectStreamMaxVersion,
} from "../db/queries/event-store";
import { insertOne, selectMany } from "../db/query";
import type { TenantId } from "../engine/types";
import { isStreamArchived } from "./archive";
import { IdempotentAppendConflictError, VersionConflictError } from "./errors";
import { eventsTable } from "./events-schema";
import { toStoredEvent } from "./row-to-stored-event";

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
//      within a tenant — a second writer racing the same expectedVersion
//      receives a PG unique violation (SQLSTATE 23505) → VersionConflictError.
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
// exists yet. Colliding creates fall out via UNIQUE (tenant_id, aggregate_id, version=1).
// Channel name used by append() → NOTIFY and the event-dispatcher → LISTEN
// (Sprint E.4). The event-dispatcher subscribes to this channel on start and
// fires a runOnce immediately on each commit, so delivery latency is bounded
// by TCP round-trip instead of pollIntervalMs.
export const EVENTS_PUBSUB_CHANNEL = "kumiko_events_new";

export async function append(db: DbRunner, event: EventToAppend): Promise<StoredEvent> {
  // Event-PII (#799): stored payload AND returned echo carry ciphertext, so
  // inline projections and rebuilds materialize identical rows.
  const payload = await encryptEventPayloadPii(event.type, event.payload);
  const toStore = payload === event.payload ? event : { ...event, payload };
  const newVersion = toStore.expectedVersion + 1;
  const eventVersion = toStore.eventVersion ?? 1;

  try {
    const row =
      toStore.expectedVersion === 0
        ? await insertFirstEvent(db, toStore, newVersion, eventVersion)
        : await insertSubsequentEvent(db, toStore, newVersion, eventVersion);

    // NOTIFY fires on commit (PG buffers NOTIFY per TX), so subscribers never
    // see a wake-up for an event that later rolled back. Harmless no-op when
    // no LISTENer is attached.
    await notifyPgChannel(db, EVENTS_PUBSUB_CHANNEL);

    return buildStoredEvent(toStore, newVersion, eventVersion, row);
  } catch (e) {
    if (isUniqueViolation(e)) {
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

type InsertReturn = { id: bigint; createdAt: Temporal.Instant };

async function insertFirstEvent(
  db: DbRunner,
  event: EventToAppend,
  newVersion: number,
  eventVersion: number,
): Promise<InsertReturn> {
  const row = await insertOne<{ id: bigint; createdAt: Temporal.Instant }>(db, eventsTable, {
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    version: newVersion,
    type: event.type,
    eventVersion,
    payload: event.payload,
    metadata: event.metadata,
    createdBy: event.metadata.userId,
  });
  if (!row) throw new Error("insertFirstEvent: INSERT RETURNING produced no row");
  return { id: row.id, createdAt: row.createdAt };
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
  });
  if (!row) throw new VersionConflictError(event.aggregateId, event.expectedVersion);
  return {
    id: typeof row.id === "bigint" ? row.id : BigInt(row.id),
    createdAt:
      row.created_at instanceof Date
        ? Temporal.Instant.fromEpochMilliseconds(row.created_at.getTime())
        : Temporal.Instant.from(row.created_at),
  };
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
export async function loadAggregate(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
  options?: { readonly includeArchived?: boolean },
): Promise<readonly StoredEvent[]> {
  if (!options?.includeArchived) {
    const archived = await isStreamArchived(db, tenantId, aggregateId);
    if (archived) return [];
  }
  const rows = await selectMany<SelectedEvent>(
    db,
    eventsTable,
    { aggregateId, tenantId },
    { orderBy: { col: "version", direction: "asc" } },
  );
  return rows.map(toStoredEvent);
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
  return selectStreamMaxVersion(db, aggregateId, tenantId);
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

/** Stream tenant of an aggregate (the tenant_id its events live under), with no
 *  membership/tenant filter. SECURITY: existence-oracle, same caveat as
 *  getUnscopedAggregateStreamMaxVersion — seed/system-internal use only. Recovers
 *  the write target for a systemScope aggregate whose stream tenant isn't one of
 *  the subject's memberships. Returns null for unknown streams. */
export async function getUnscopedAggregateStreamTenant(
  db: DbRunner,
  aggregateId: string,
  aggregateType: string,
): Promise<TenantId | null> {
  const tenantId = await selectAggregateStreamTenant(db, aggregateId, aggregateType);
  // DB-boundary: kumiko_events.tenant_id is a TenantId-shaped uuid column.
  return tenantId as TenantId | null;
}

// Global high-water-mark = MAX(events.id). Marten/Wolverine standard for
// projection/consumer lag math: lag = HWM - cursor. Single-row aggregate over
// the bigserial PK index — sub-millisecond cost. Returns 0n on an empty log
// (boot, fresh tenant, post-archive).
// @wrapper-known semantic-alias
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

// Load every event for an aggregate_type across all tenants. Ordered by
// (created_at, id) — chronological replay order for projection rebuilds.
// Mostly called from tests today — production rebuild goes through
// projection-rebuild's own streaming path.
//
// Fails loud past LOAD_ALL_EVENTS_ROW_LIMIT rather than silently buffering
// an unbounded result set — that's the memory cliff this guard exists to
// prevent.
export const LOAD_ALL_EVENTS_ROW_LIMIT = 100_000;

/** @deprecated buffers ALL matching events in memory — a memory cliff for large stores. Use `streamAllEventsByType` (yields batchwise) instead. */
export async function loadAllEventsByType(
  db: DbRunner,
  aggregateType: string,
  rowLimit: number = LOAD_ALL_EVENTS_ROW_LIMIT,
): Promise<readonly StoredEvent[]> {
  const rows = await selectMany<SelectedEvent>(
    db,
    eventsTable,
    { aggregateType },
    {
      orderBy: [
        { col: "createdAt", direction: "asc" },
        { col: "id", direction: "asc" },
      ],
      limit: rowLimit + 1,
    },
  );
  if (rows.length > rowLimit) {
    throw new Error(
      `loadAllEventsByType("${aggregateType}") exceeds ${rowLimit} rows — ` +
        "use streamAllEventsByType instead of buffering the full result set in memory.",
    );
  }
  return rows.map(toStoredEvent);
}

// Stream every event for an aggregate_type across all tenants, batchwise
// instead of buffered. Memory-bounded: never more than `batchSize` rows
// resident. Cursor walks `events.id` (bigserial monotonic — concurrent
// inserts get distinct ids in commit order, so no duplicates and no skips
// past the cursor).
//
// Use case: projection-rebuild on a large event log (>100k events per
// aggregate-type). loadAllEventsByType would OOM; this iterator yields
// in batches and the caller accumulates only what it needs.
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
// in-flight queries are not actively cancelled (postgres-js connection-
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
