import type { AnyDb } from "../query";
import { asRawClient } from "../query";

export type RawFirstEventInsertParams = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: string;
  readonly newVersion: number;
  readonly type: string;
  readonly eventVersion: number;
  readonly payloadJson: string;
  readonly metadataJson: string;
  readonly createdAt: string;
  readonly createdBy: string;
};

export async function insertRawFirstEvent(
  db: AnyDb,
  params: RawFirstEventInsertParams,
): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_events" (
       aggregate_id, aggregate_type, tenant_id, version,
       type, event_version, payload, metadata, created_at, created_by
     )
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10)`,
    [
      params.aggregateId,
      params.aggregateType,
      params.tenantId,
      params.newVersion,
      params.type,
      params.eventVersion,
      params.payloadJson,
      params.metadataJson,
      params.createdAt,
      params.createdBy,
    ],
  );
}

export type RawSubsequentEventInsertParams = RawFirstEventInsertParams & {
  readonly expectedVersion: number;
};

export async function insertRawSubsequentEvent(
  db: AnyDb,
  params: RawSubsequentEventInsertParams,
): Promise<boolean> {
  const rows = (await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_events" (
       aggregate_id, aggregate_type, tenant_id, version,
       type, event_version, payload, metadata, created_at, created_by
     )
     SELECT $1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10
     WHERE EXISTS (
       SELECT 1 FROM "kumiko_events"
       WHERE aggregate_id = $1::uuid
         AND version = $11
         AND tenant_id = $3::uuid
     )
     RETURNING id`,
    [
      params.aggregateId,
      params.aggregateType,
      params.tenantId,
      params.newVersion,
      params.type,
      params.eventVersion,
      params.payloadJson,
      params.metadataJson,
      params.createdAt,
      params.createdBy,
      params.expectedVersion,
    ],
  )) as ReadonlyArray<{ id: string }>;
  return rows.length > 0;
}

export async function insertRawEventBatch(
  db: AnyDb,
  sqlValues: string,
  params: unknown[],
): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_events" (
       aggregate_id, aggregate_type, tenant_id, version,
       type, event_version, payload, metadata, created_at, created_by
     )
     VALUES ${sqlValues}`,
    params,
  );
}

export async function eventPredecessorExists(
  db: AnyDb,
  aggregateId: string,
  tenantId: string,
  version: number,
): Promise<boolean> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT EXISTS(
       SELECT 1 FROM "kumiko_events"
       WHERE aggregate_id = $1::uuid
         AND tenant_id = $2::uuid
         AND version = $3
     ) AS present`,
    [aggregateId, tenantId, version],
  )) as ReadonlyArray<{ present: boolean }>;
  return rows[0]?.present === true;
}

export async function findExistingEventVersion(
  db: AnyDb,
  sqlInClause: string,
  params: unknown[],
): Promise<{ aggregateId: string; version: number } | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT aggregate_id, version FROM "kumiko_events"
     WHERE (tenant_id, aggregate_id, version) IN (${sqlInClause})
     LIMIT 1`,
    params,
  )) as ReadonlyArray<{ aggregate_id: string; version: number }>;
  const row = rows[0];
  if (!row) return undefined;
  return { aggregateId: row.aggregate_id, version: row.version };
}
