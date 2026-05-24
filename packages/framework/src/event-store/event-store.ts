import type { DbRunner } from "../db";
import { isUniqueViolation } from "../db/pg-error";
import { asRawClient, insertOne, selectMany } from "../db/query";
import type { TenantId } from "../engine/types";
import { isStreamArchived } from "./archive";
import { VersionConflictError } from "./errors";
import { eventsTable } from "./events-schema";

export type EventMetadata = {
  readonly userId: string;
  readonly requestId?: string;
  // End-to-end business-operation id. Root HTTP requests get it from the
  // x-correlation-id header (default: requestId). MSP-applies inherit it
  // from the triggering event. Lets you trace "which user click caused
  // this email 3 streams later?".
  readonly correlationId?: string;
  // Stored event id that triggered this write. Null for root commands;
  // set to event.id when an MSP-apply runs ctx.appendEvent. Together with
  // correlationId forms a causation DAG across aggregate streams.
  readonly causationId?: string;
  // Marten-conform free key/value space for app-specific metadata that
  // doesn't deserve its own EventMetadata field. Examples: A/B-test bucket,
  // feature-flag snapshot, geo-region, client SDK version. Persisted into
  // events.metadata jsonb (no schema change — it's already a free-form
  // jsonb column), survives upcasters untouched, available on every
  // StoredEvent.metadata.headers. Framework does not interpret values; the
  // app reads them when filtering/auditing. Keep values JSON-primitive
  // (string|number|boolean) so JSON serialization stays bulletproof.
  readonly headers?: Readonly<Record<string, string | number | boolean>>;
};

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

// Generic über payload-shape. Default = Record<string, unknown> macht
// alle existierenden Konsumenten backwards-compatible. Konkrete Apply-
// Handler / Tests können `StoredEvent<MyEventPayload>` annotieren um
// payload typed zu lesen. Type-Propagation kommt durch r.defineEvent +
// SingleStreamApplyFn<T> in apply-Maps.
export type StoredEvent<TPayload = Record<string, unknown>> = {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  readonly version: number;
  readonly type: string;
  readonly eventVersion: number;
  readonly payload: TPayload;
  readonly metadata: EventMetadata;
  readonly createdAt: Temporal.Instant;
  readonly createdBy: string;
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
  const newVersion = event.expectedVersion + 1;
  const eventVersion = event.eventVersion ?? 1;

  try {
    const row =
      event.expectedVersion === 0
        ? await insertFirstEvent(db, event, newVersion, eventVersion)
        : await insertSubsequentEvent(db, event, newVersion, eventVersion);

    // NOTIFY fires on commit (PG buffers NOTIFY per TX), so subscribers never
    // see a wake-up for an event that later rolled back. Harmless no-op when
    // no LISTENer is attached.
    await asRawClient(db).unsafe(`SELECT pg_notify($1, '')`, [EVENTS_PUBSUB_CHANNEL]);

    return buildStoredEvent(event, newVersion, eventVersion, row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Only constraint left on the events table: events_aggregate_version_uq
      // on (tenant_id, aggregate_id, version). A unique violation here always
      // means a concurrent writer in the same tenant won the race to the
      // next version — retry-able conflict.
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
  const payloadJson = JSON.stringify(event.payload);
  const metadataJson = JSON.stringify(event.metadata);
  const rows = (await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_events" (
       aggregate_id, aggregate_type, tenant_id, version,
       type, event_version, payload, metadata, created_by
     )
     SELECT $1::uuid, $2, $3::uuid, $4,
            $5, $6, $7::jsonb,
            $8::jsonb, $9
     WHERE EXISTS (
       SELECT 1 FROM "kumiko_events"
       WHERE aggregate_id = $1::uuid
         AND version = $10
         AND tenant_id = $3::uuid
     )
     RETURNING id, created_at`,
    [
      event.aggregateId,
      event.aggregateType,
      event.tenantId,
      newVersion,
      event.type,
      eventVersion,
      payloadJson,
      metadataJson,
      event.metadata.userId,
      event.expectedVersion,
    ],
  )) as ReadonlyArray<{ id: string | bigint; created_at: Date | string }>;
  const row = rows[0];
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
export async function getStreamVersion(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
): Promise<number> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT MAX("version") AS v FROM "kumiko_events" WHERE "aggregate_id" = $1 AND "tenant_id" = $2`,
    [aggregateId, tenantId],
  )) as ReadonlyArray<{ v: number | null }>;
  return rows[0]?.v ?? 0;
}

// Global high-water-mark = MAX(events.id). Marten/Wolverine standard for
// projection/consumer lag math: lag = HWM - cursor. Single-row aggregate over
// the bigserial PK index — sub-millisecond cost. Returns 0n on an empty log
// (boot, fresh tenant, post-archive).
export async function getEventsHighWaterMark(db: DbRunner): Promise<bigint> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT COALESCE(MAX("id"), 0)::bigint AS max FROM "kumiko_events"`,
  )) as ReadonlyArray<{ max: bigint | string | number | null }>;
  const raw = rows[0]?.max;
  if (typeof raw === "bigint") return raw;
  if (raw === null || raw === undefined) return 0n;
  return BigInt(raw);
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
//
// CAUTION — buffers ALL matching events in memory. Safe for smaller
// aggregate-types (≤ 100k events), a memory cliff for large stores.
// For >100k events use `streamAllEventsByType` (yields batchwise).
// Mostly called from tests today — production rebuild goes through
// projection-rebuild's own streaming path.
export async function loadAllEventsByType(
  db: DbRunner,
  aggregateType: string,
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
    },
  );
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

function toStoredEvent(row: SelectedEvent): StoredEvent {
  return {
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
}
