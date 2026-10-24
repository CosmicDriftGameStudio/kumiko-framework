// One-time migration tooling for event streams that live on the wrong tenant.
//
// An aggregate type that became tenant-independent (systemStream) or whose
// stream must follow the tenant in its payload has older streams on whichever
// tenant happened to write them. Newer writes then version-conflict against
// the empty target stream, and a raw tenant_id UPDATE trips
// events_aggregate_version_uq as soon as an aggregate has BOTH a legacy
// stream and newer events on the target (split stream).
//
// This tool merges per aggregate: all events of the aggregate, ordered by
// global event id, are renumbered 1..n and retenanted to the target - two-phase
// version writes (negative interim values) dodge the unique index while the
// per-aggregate transaction is in flight. Snapshots of migrated aggregates
// are dropped (version numbering changed; the next snapshotting load
// recreates them); archived-stream markers move with the stream.
//
// Idempotent: candidates are only aggregates that still have events outside
// their target tenant. One failing aggregate does not abort the run: the rest
// of the estate migrates, failures are reported.
//
// After a run, rebuild the affected projections so read-table tenant_id
// reflects the stream move.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { asRawClient, transaction, unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

export type StreamTenantTarget =
  | { readonly kind: "system" }
  // The tenantId carried by the aggregate's earliest event payload.
  | { readonly kind: "payload-tenant" };

export type StreamBackfillCandidate = {
  readonly aggregateId: string;
  readonly targetTenantId: string;
  readonly sourceTenantIds: readonly string[];
};

export type StreamBackfillFailure = { readonly aggregateId: string; readonly error: string };

export type StreamBackfillResult = {
  readonly aggregatesMigrated: number;
  readonly eventsMigrated: number;
  readonly failed: readonly StreamBackfillFailure[];
};

export type StreamBackfillOptions = {
  readonly aggregateType: string;
  readonly target: StreamTenantTarget;
  // Runs per candidate before its events move; a throw skips the aggregate
  // and lands in `failed` (search cleanup must not be lost by a move).
  readonly beforeMove?: (candidate: StreamBackfillCandidate) => Promise<void>;
};

type CandidateRow = {
  aggregate_id: string;
  target_tenant_id: string | null;
  source_tenant_ids: string[];
};

export async function backfillAggregateStreamTenants(
  db: DbConnection,
  options: StreamBackfillOptions,
): Promise<StreamBackfillResult> {
  const rows = await readCandidateRows(db, options);

  let aggregatesMigrated = 0;
  let eventsMigrated = 0;
  const failed: StreamBackfillFailure[] = [];

  for (const row of rows) {
    try {
      if (!row.target_tenant_id) {
        throw new Error(`earliest event of the aggregate carries no payload.tenantId`);
      }
      const candidate: StreamBackfillCandidate = {
        aggregateId: row.aggregate_id,
        targetTenantId: row.target_tenant_id,
        sourceTenantIds: row.source_tenant_ids,
      };
      await options.beforeMove?.(candidate);
      eventsMigrated += await migrateAggregate(db, options.aggregateType, candidate);
      aggregatesMigrated++;
    } catch (e) {
      failed.push({
        aggregateId: row.aggregate_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { aggregatesMigrated, eventsMigrated, failed };
}

async function readCandidateRows(
  db: DbConnection,
  options: StreamBackfillOptions,
): Promise<readonly CandidateRow[]> {
  const targetSql =
    options.target.kind === "system"
      ? `$2::text`
      : `(SELECT e2."payload"->>'tenantId' FROM "kumiko_events" e2
           WHERE e2."aggregate_type" = $1 AND e2."aggregate_id" = e."aggregate_id"
           ORDER BY e2."id" ASC LIMIT 1)`;
  const params: unknown[] = [options.aggregateType];
  if (options.target.kind === "system") params.push(SYSTEM_TENANT_ID);
  // An aggregate whose earliest event has no payload tenant yields a NULL
  // target and is reported as failed instead of being silently skipped.
  return unsafeReadRetrying<CandidateRow>(
    db,
    `SELECT e."aggregate_id" AS aggregate_id,
            ${targetSql} AS target_tenant_id,
            array_agg(DISTINCT e."tenant_id"::text) AS source_tenant_ids
       FROM "kumiko_events" e
      WHERE e."aggregate_type" = $1
      GROUP BY e."aggregate_id"
     HAVING bool_or(e."tenant_id"::text IS DISTINCT FROM ${targetSql})`,
    params,
  );
}

async function migrateAggregate(
  db: DbConnection,
  aggregateType: string,
  candidate: StreamBackfillCandidate,
): Promise<number> {
  const { aggregateId, targetTenantId } = candidate;
  return transaction(db, async (tx) => {
    const raw = asRawClient(tx);
    // Global id order = commit-adjacent replay order; merges a split stream
    // into one consistent version sequence.
    const events = await raw.unsafe<{ id: bigint | string }>(
      `SELECT "id" FROM "kumiko_events"
        WHERE "aggregate_type" = $1 AND "aggregate_id" = $2::uuid
        ORDER BY "id" ASC
        FOR UPDATE`,
      [aggregateType, aggregateId],
    );

    // Negative interim versions: real versions are always >= 1, so nothing
    // can collide with events_aggregate_version_uq mid-migration.
    for (const [i, ev] of events.entries()) {
      await raw.unsafe(
        `UPDATE "kumiko_events" SET "tenant_id" = $1::uuid, "version" = $2 WHERE "id" = $3`,
        [targetTenantId, -(i + 1), ev.id],
      );
    }
    for (const [i, ev] of events.entries()) {
      await raw.unsafe(`UPDATE "kumiko_events" SET "version" = $1 WHERE "id" = $2`, [i + 1, ev.id]);
    }

    // Version numbering changed, so any snapshot of this aggregate is stale.
    await raw.unsafe(`DELETE FROM "kumiko_snapshots" WHERE "aggregate_id" = $1::uuid`, [
      aggregateId,
    ]);

    // Archived markers key on (tenant_id, aggregate_id): move them with the
    // stream, keeping an existing target marker if both exist.
    await raw.unsafe(
      `INSERT INTO "kumiko_archived_streams" ("tenant_id", "aggregate_id", "aggregate_type", "archived_at", "archived_by", "reason")
        SELECT $1::uuid, "aggregate_id", "aggregate_type", "archived_at", "archived_by", "reason"
          FROM "kumiko_archived_streams"
         WHERE "aggregate_id" = $2::uuid AND "tenant_id" <> $1::uuid
        ON CONFLICT DO NOTHING`,
      [targetTenantId, aggregateId],
    );
    await raw.unsafe(
      `DELETE FROM "kumiko_archived_streams" WHERE "aggregate_id" = $1::uuid AND "tenant_id" <> $2::uuid`,
      [aggregateId, targetTenantId],
    );

    return events.length;
  });
}
