import { and, asc, eq, gt, lte, max, sql } from "drizzle-orm";
import type { DbRunner } from "../db";
import { constraintOf, isUniqueViolation } from "../db/pg-error";
import type { TenantId } from "../engine/types";
import { isStreamArchived } from "./archive";
import { IdempotencyReplayError, VersionConflictError } from "./errors";
import { eventsTable } from "./events-schema";

export type EventMetadata = {
  readonly userId: string;
  readonly requestId?: string;
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

export type StoredEvent = {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  readonly version: number;
  readonly type: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: EventMetadata;
  readonly createdAt: Date;
  readonly createdBy: string;
};

type SelectedEvent = typeof eventsTable.$inferSelect;

// Append one event atomically. Two guarantees combined:
//
//   1. UNIQUE (aggregate_id, version) serializes concurrent writers —
//      a second writer racing the same expectedVersion receives a PG unique
//      violation (SQLSTATE 23505) → VersionConflictError.
//
//   2. For updates (expectedVersion > 0), INSERT … SELECT … WHERE EXISTS
//      requires the predecessor event to exist AND belong to the same tenant.
//      Without this, tenant B could "hijack" tenant A's aggregate_id simply
//      by passing a guessed expectedVersion — the unique constraint alone
//      wouldn't catch cross-tenant writes because the version numbers would
//      be non-colliding (A has v1, B writes v2). Single round-trip.
//
// Creates (expectedVersion === 0) skip the predecessor check — no predecessor
// exists yet. Colliding creates fall out via UNIQUE (aggregate_id, version=1).
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
    await db.execute(sql`SELECT pg_notify(${EVENTS_PUBSUB_CHANNEL}, '')`);

    return buildStoredEvent(event, newVersion, eventVersion, row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Distinguish the two unique constraints:
      //   - events_aggregate_version_uq → concurrent writer beat us
      //   - events_idempotency_idx → same requestId already processed
      // Callers need different semantics: the former is a retry-able conflict,
      // the latter is a signal to look up and replay the prior outcome.
      if (constraintOf(e) === "events_idempotency_idx" && event.metadata.requestId) {
        throw new IdempotencyReplayError(event.tenantId, event.metadata.requestId);
      }
      throw new VersionConflictError(event.aggregateId, event.expectedVersion);
    }
    throw e;
  }
}

type InsertReturn = { id: bigint; createdAt: Date };

async function insertFirstEvent(
  db: DbRunner,
  event: EventToAppend,
  newVersion: number,
  eventVersion: number,
): Promise<InsertReturn> {
  const [row] = await db
    .insert(eventsTable)
    .values({
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      tenantId: event.tenantId,
      version: newVersion,
      type: event.type,
      eventVersion,
      payload: event.payload,
      metadata: event.metadata,
      createdBy: event.metadata.userId,
    })
    .returning({ id: eventsTable.id, createdAt: eventsTable.createdAt });
  if (!row) throw new Error("insertFirstEvent: INSERT RETURNING produced no row");
  return row;
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
  const rows = await db.execute<{ id: string; created_at: Date | string }>(sql`
    INSERT INTO ${eventsTable} (
      aggregate_id, aggregate_type, tenant_id, version,
      type, event_version, payload, metadata, created_by
    )
    SELECT ${event.aggregateId}::uuid, ${event.aggregateType}, ${event.tenantId}::uuid, ${newVersion},
           ${event.type}, ${eventVersion}, ${payloadJson}::jsonb,
           ${metadataJson}::jsonb, ${event.metadata.userId}
    WHERE EXISTS (
      SELECT 1 FROM ${eventsTable}
      WHERE aggregate_id = ${event.aggregateId}::uuid
        AND version = ${event.expectedVersion}
        AND tenant_id = ${event.tenantId}::uuid
    )
    RETURNING id, created_at;
  `);
  const arr = rows as unknown as Array<{ id: string; created_at: Date | string }>;
  const row = arr[0];
  if (!row) throw new VersionConflictError(event.aggregateId, event.expectedVersion);
  return {
    id: BigInt(row.id),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
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
  const rows = await db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.aggregateId, aggregateId), eq(eventsTable.tenantId, tenantId)))
    .orderBy(asc(eventsTable.version));
  return rows.map(toStoredEvent);
}

// Load events up to a point in time. Used for asOf queries that reconstruct
// historical state. Includes events whose created_at is <= asOf. Same
// archive semantics as loadAggregate.
export async function loadAggregateAsOf(
  db: DbRunner,
  aggregateId: string,
  tenantId: TenantId,
  asOf: Date,
  options?: { readonly includeArchived?: boolean },
): Promise<readonly StoredEvent[]> {
  if (!options?.includeArchived) {
    const archived = await isStreamArchived(db, tenantId, aggregateId);
    if (archived) return [];
  }
  const rows = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.aggregateId, aggregateId),
        eq(eventsTable.tenantId, tenantId),
        lte(eventsTable.createdAt, asOf),
      ),
    )
    .orderBy(asc(eventsTable.version));
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
  const [row] = await db
    .select({ v: max(eventsTable.version) })
    .from(eventsTable)
    .where(and(eq(eventsTable.aggregateId, aggregateId), eq(eventsTable.tenantId, tenantId)));
  return row?.v ?? 0;
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
  const rows = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.aggregateId, aggregateId),
        eq(eventsTable.tenantId, tenantId),
        gt(eventsTable.version, afterVersion),
      ),
    )
    .orderBy(asc(eventsTable.version));
  return rows.map(toStoredEvent);
}

// Load every event for an aggregate_type across all tenants. Ordered by
// (created_at, id) — chronological replay order for projection rebuilds.
// Buffers in memory; Phase 3+ will stream for very large stores.
export async function loadAllEventsByType(
  db: DbRunner,
  aggregateType: string,
): Promise<readonly StoredEvent[]> {
  const rows = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.aggregateType, aggregateType))
    .orderBy(asc(eventsTable.createdAt), asc(eventsTable.id));
  return rows.map(toStoredEvent);
}

// Look up an event by (tenant, requestId). Used by the command layer when
// IdempotencyReplayError fires — we need to return the prior event's outcome
// so callers can't tell whether they got replayed or freshly processed.
// JSONB path operator requires an inline sql fragment; the typed builder
// doesn't expose `->>` as a first-class operator.
export async function findEventByRequestId(
  db: DbRunner,
  tenantId: TenantId,
  requestId: string,
): Promise<StoredEvent | null> {
  const rows = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.tenantId, tenantId),
        sql`${eventsTable.metadata}->>'requestId' = ${requestId}`,
      ),
    )
    .limit(1);
  return rows[0] ? toStoredEvent(rows[0]) : null;
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
