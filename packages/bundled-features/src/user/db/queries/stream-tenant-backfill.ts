// #762 — one-time migration tooling for pre-#497 user event streams.
//
// #497 made `user` a systemStream entity: every executor op addresses the
// stream on SYSTEM_TENANT_ID. Streams created before that live on whichever
// tenant created them ("scattered"), so post-#497 writes version-conflict
// against the empty SYSTEM stream. The raw UPDATE documented in the #497
// changeset breaks as soon as an aggregate has BOTH a legacy stream and
// post-#497 SYSTEM events (split stream — e.g. a skipOptimisticLock
// lifecycle write appended v1 on SYSTEM while v1..n live on the old
// tenant): retenanting then trips events_aggregate_version_uq.
//
// This tool merges per aggregate: all user events, ordered by global event
// id, are renumbered 1..n and retenanted to SYSTEM_TENANT_ID — two-phase
// version writes (negative interim values) dodge the unique index while the
// per-aggregate transaction is in flight. Snapshots of migrated aggregates
// are dropped (version numbering changed; the next snapshotting load
// recreates them); archived-stream markers move with the stream.
//
// Idempotent: the candidate query only matches aggregates that still have
// non-SYSTEM events. One failing aggregate does not abort the run — the
// rest of the estate migrates, failures are reported.
//
// After a run, rebuild the user projection so read_users.tenant_id reflects
// the stream move: rebuildProjection("user:projection:user-entity", ...) or
// the jobs:job:projection-rebuild job.

import { asRawClient, transaction } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

export type UserStreamBackfillResult = {
  readonly aggregatesMigrated: number;
  readonly eventsMigrated: number;
  readonly failed: ReadonlyArray<{ readonly aggregateId: string; readonly error: string }>;
};

export async function backfillUserStreamTenants(
  db: DbConnection,
): Promise<UserStreamBackfillResult> {
  const candidates = (await asRawClient(db).unsafe(
    `SELECT DISTINCT "aggregate_id" FROM "kumiko_events"
      WHERE "aggregate_type" = 'user' AND "tenant_id" <> $1::uuid`,
    [SYSTEM_TENANT_ID],
  )) as ReadonlyArray<{ aggregate_id: string }>;

  let aggregatesMigrated = 0;
  let eventsMigrated = 0;
  const failed: Array<{ aggregateId: string; error: string }> = [];

  for (const { aggregate_id } of candidates) {
    try {
      eventsMigrated += await migrateAggregate(db, aggregate_id);
      aggregatesMigrated++;
    } catch (e) {
      failed.push({
        aggregateId: aggregate_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { aggregatesMigrated, eventsMigrated, failed };
}

async function migrateAggregate(db: DbConnection, aggregateId: string): Promise<number> {
  return transaction(db, async (tx) => {
    const raw = asRawClient(tx);
    // Global id order = commit-adjacent replay order; merges a split stream
    // (legacy tenant + SYSTEM) into one consistent version sequence.
    const events = (await raw.unsafe(
      `SELECT "id" FROM "kumiko_events"
        WHERE "aggregate_type" = 'user' AND "aggregate_id" = $1::uuid
        ORDER BY "id" ASC
        FOR UPDATE`,
      [aggregateId],
    )) as ReadonlyArray<{ id: bigint | string }>;

    // Phase 1: negative interim versions — real versions are always >= 1, so
    // nothing can collide with events_aggregate_version_uq mid-migration.
    for (const [i, ev] of events.entries()) {
      await raw.unsafe(
        `UPDATE "kumiko_events" SET "tenant_id" = $1::uuid, "version" = $2 WHERE "id" = $3`,
        [SYSTEM_TENANT_ID, -(i + 1), ev.id],
      );
    }
    // Phase 2: final contiguous 1..n.
    for (const [i, ev] of events.entries()) {
      await raw.unsafe(`UPDATE "kumiko_events" SET "version" = $1 WHERE "id" = $2`, [i + 1, ev.id]);
    }

    // Version numbering changed → any snapshot of this aggregate is stale.
    await raw.unsafe(`DELETE FROM "kumiko_snapshots" WHERE "aggregate_id" = $1::uuid`, [
      aggregateId,
    ]);

    // Archived markers key on (tenant_id, aggregate_id) — move them with the
    // stream, keeping an existing SYSTEM marker if both exist.
    await raw.unsafe(
      `INSERT INTO "kumiko_archived_streams" ("tenant_id", "aggregate_id", "aggregate_type", "archived_at", "archived_by", "reason")
        SELECT $1::uuid, "aggregate_id", "aggregate_type", "archived_at", "archived_by", "reason"
          FROM "kumiko_archived_streams"
         WHERE "aggregate_id" = $2::uuid AND "tenant_id" <> $1::uuid
        ON CONFLICT DO NOTHING`,
      [SYSTEM_TENANT_ID, aggregateId],
    );
    await raw.unsafe(
      `DELETE FROM "kumiko_archived_streams" WHERE "aggregate_id" = $1::uuid AND "tenant_id" <> $2::uuid`,
      [aggregateId, SYSTEM_TENANT_ID],
    );

    return events.length;
  });
}
