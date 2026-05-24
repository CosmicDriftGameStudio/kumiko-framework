import type { AnyDb } from "../query";
import { asRawClient } from "../query";

/** NOTIFY on commit — wakes LISTEN subscribers (event-dispatcher). */
export async function notifyPgChannel(db: AnyDb, channel: string): Promise<void> {
  await asRawClient(db).unsafe(`SELECT pg_notify($1, '')`, [channel]);
}

export type SubsequentEventInsertParams = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: string;
  readonly newVersion: number;
  readonly type: string;
  readonly eventVersion: number;
  readonly payloadJson: string;
  readonly metadataJson: string;
  readonly createdBy: string;
  readonly expectedVersion: number;
};

export type SubsequentEventInsertRow = {
  readonly id: string | bigint;
  readonly created_at: Date | string;
};

/** INSERT … SELECT … WHERE EXISTS predecessor — stays raw (typed builder can't express this). */
export async function insertSubsequentEventRow(
  db: AnyDb,
  params: SubsequentEventInsertParams,
): Promise<SubsequentEventInsertRow | undefined> {
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
      params.aggregateId,
      params.aggregateType,
      params.tenantId,
      params.newVersion,
      params.type,
      params.eventVersion,
      params.payloadJson,
      params.metadataJson,
      params.createdBy,
      params.expectedVersion,
    ],
  )) as ReadonlyArray<SubsequentEventInsertRow>;
  return rows[0];
}

export async function selectStreamMaxVersion(
  db: AnyDb,
  aggregateId: string,
  tenantId: string,
): Promise<number> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT MAX("version") AS v FROM "kumiko_events" WHERE "aggregate_id" = $1 AND "tenant_id" = $2`,
    [aggregateId, tenantId],
  )) as ReadonlyArray<{ v: number | null }>;
  return rows[0]?.v ?? 0;
}

/** MAX(version) for one aggregate stream — no tenant filter (seed idempotency). */
export async function selectAggregateMaxVersion(db: AnyDb, aggregateId: string): Promise<number> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT MAX("version") AS v FROM "kumiko_events" WHERE "aggregate_id" = $1`,
    [aggregateId],
  )) as ReadonlyArray<{ v: number | null }>;
  return rows[0]?.v ?? 0;
}

export async function selectEventsHighWaterMark(db: AnyDb): Promise<bigint> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT COALESCE(MAX("id"), 0)::bigint AS max FROM "kumiko_events"`,
  )) as ReadonlyArray<{ max: bigint | string | number | null }>;
  const raw = rows[0]?.max;
  if (typeof raw === "bigint") return raw;
  if (raw === null || raw === undefined) return 0n;
  return BigInt(raw);
}

/** Head event id for lag metrics — same aggregate as selectEventsHighWaterMark. */
export async function selectEventsHeadId(db: AnyDb): Promise<bigint> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT COALESCE(MAX(id), 0)::bigint AS head FROM kumiko_events`,
  )) as ReadonlyArray<{ head?: bigint | string | null }>;
  const raw = rows[0]?.head;
  if (typeof raw === "bigint") return raw;
  return BigInt(raw ?? 0);
}

export async function selectNextEventIdAfter(db: AnyDb, afterId: bigint): Promise<bigint | null> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT "id" FROM "kumiko_events" WHERE "id" > $1 ORDER BY "id" ASC LIMIT 1`,
    [afterId],
  )) as ReadonlyArray<{ id: string | bigint }>;
  const row = rows[0];
  if (!row) return null;
  return typeof row.id === "bigint" ? row.id : BigInt(row.id);
}

export type SaveSnapshotParams = {
  readonly aggregateId: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly version: number;
  readonly stateJson: string;
};

export async function upsertSnapshot(db: AnyDb, params: SaveSnapshotParams): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_snapshots"
       ("aggregate_id", "tenant_id", "aggregate_type", "version", "state")
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT ("aggregate_id", "version") DO UPDATE SET
       "state" = $5::jsonb,
       "aggregate_type" = $3,
       "created_at" = now()`,
    [params.aggregateId, params.tenantId, params.aggregateType, params.version, params.stateJson],
  );
}

export type ArchiveStreamParams = {
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly archivedBy: string;
  readonly reason: string | null;
};

export async function upsertArchivedStream(db: AnyDb, params: ArchiveStreamParams): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_archived_streams"
       ("tenant_id", "aggregate_id", "aggregate_type", "archived_by", "reason")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("tenant_id", "aggregate_id") DO UPDATE SET
       "archived_at" = now(),
       "archived_by" = $4,
       "aggregate_type" = $3,
       "reason" = $5`,
    [params.tenantId, params.aggregateId, params.aggregateType, params.archivedBy, params.reason],
  );
}
