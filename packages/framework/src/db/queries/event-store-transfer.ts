// Raw SQL backing event-store/transfer.ts — the framework's own tenant-transfer
// primitive for streams. Kept in db/queries alongside the rest of the
// event-store's raw statements (see event-store.ts, event-store-admin.ts,
// backfill-pii.ts): the one place in the repo allowed to write tenant_id
// directly onto kumiko_events / kumiko_snapshots / kumiko_archived_streams.

import type { AnyDb } from "../query.js";
import { asRawClient } from "../query.js";

export type TransferEventRowsParams = {
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
  readonly aggregateType: string;
  readonly aggregateIds: readonly string[];
};

// Postgres' RETURNING clause has no DISTINCT keyword — dedupe the
// per-event-row hits in-process instead of relying on invalid SQL.
export async function transferEventRows(
  db: AnyDb,
  params: TransferEventRowsParams,
): Promise<readonly string[]> {
  const rows = (await asRawClient(db).unsafe(
    `UPDATE "kumiko_events" SET "tenant_id" = $1 ` +
      `WHERE "tenant_id" = $2 AND "aggregate_type" = $3 AND "aggregate_id" = ANY($4) ` +
      `RETURNING "aggregate_id" AS id`,
    [params.destinationTenantId, params.sourceTenantId, params.aggregateType, params.aggregateIds],
  )) as ReadonlyArray<{ id: string }>;
  return [...new Set(rows.map((row) => row.id))];
}

export type DeleteSnapshotsForAggregatesParams = {
  readonly tenantId: string;
  readonly aggregateIds: readonly string[];
};

// Snapshots are a pure read-performance cache (event-store/snapshot.ts) —
// dropped rather than rewritten, forcing a full replay from the just-moved
// events on next read instead of carrying the snapshot's own generation
// bookkeeping across the tenant boundary.
export async function deleteSnapshotsForAggregates(
  db: AnyDb,
  params: DeleteSnapshotsForAggregatesParams,
): Promise<void> {
  await asRawClient(db).unsafe(
    `DELETE FROM "kumiko_snapshots" WHERE "tenant_id" = $1 AND "aggregate_id" = ANY($2)`,
    [params.tenantId, params.aggregateIds],
  );
}

export type TransferArchivedStreamRowsParams = {
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
  readonly aggregateType: string;
  readonly aggregateIds: readonly string[];
};

// An archived stream's marker must move with it — leaving it behind would
// make the stream writable again the instant it lands in the destination
// tenant (archive.ts's isStreamArchived check is itself tenant-scoped).
// `aggregate_type` is part of the match, same as transferEventRows — an
// archived marker for a DIFFERENT aggregate type that happens to share the
// moved aggregate's id must stay in the source tenant.
export async function transferArchivedStreamRows(
  db: AnyDb,
  params: TransferArchivedStreamRowsParams,
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_archived_streams" SET "tenant_id" = $1 ` +
      `WHERE "tenant_id" = $2 AND "aggregate_type" = $3 AND "aggregate_id" = ANY($4)`,
    [params.destinationTenantId, params.sourceTenantId, params.aggregateType, params.aggregateIds],
  );
}
