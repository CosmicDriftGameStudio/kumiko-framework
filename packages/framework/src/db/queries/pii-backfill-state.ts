import type { AnyDb } from "../query.js";
import { asRawClient } from "../query.js";

export type PiiBackfillStateRow = {
  readonly cursor: string;
  readonly completed: boolean;
  // Events the scan moved past after they failed; retried individually on every boot.
  readonly failedEventIds: readonly string[];
};

export async function readPiiBackfillState(
  db: AnyDb,
  fingerprint: string,
): Promise<PiiBackfillStateRow | null> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT "cursor_event_id"::text AS "cursor", "completed_at" IS NOT NULL AS "completed",
            "failed_event_ids"::text[] AS "failedEventIds"
       FROM "kumiko_pii_backfill_state" WHERE "fingerprint" = $1`,
    [fingerprint],
  )) as ReadonlyArray<PiiBackfillStateRow>;
  return rows[0] ?? null;
}

export type PiiBackfillStateUpdate = {
  readonly cursor: bigint;
  readonly markCompleted: boolean;
  readonly addFailedEventIds: readonly string[];
  readonly removeFailedEventIds: readonly string[];
};

export async function persistPiiBackfillState(
  db: AnyDb,
  fingerprint: string,
  update: PiiBackfillStateUpdate,
): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_pii_backfill_state" ("fingerprint", "cursor_event_id", "completed_at", "failed_event_ids", "updated_at")
     VALUES ($1, $2::bigint, CASE WHEN $3::boolean THEN now() ELSE NULL END, $4::bigint[], now())
     ON CONFLICT ("fingerprint") DO UPDATE SET
       "cursor_event_id" = GREATEST("kumiko_pii_backfill_state"."cursor_event_id", EXCLUDED."cursor_event_id"),
       "completed_at" = COALESCE("kumiko_pii_backfill_state"."completed_at", EXCLUDED."completed_at"),
       "failed_event_ids" = ARRAY(
         SELECT DISTINCT failed FROM unnest("kumiko_pii_backfill_state"."failed_event_ids" || EXCLUDED."failed_event_ids") AS failed
          WHERE failed <> ALL($5::bigint[])
          ORDER BY failed),
       "updated_at" = now()`,
    [
      fingerprint,
      update.cursor.toString(),
      update.markCompleted,
      [...update.addFailedEventIds],
      [...update.removeFailedEventIds],
    ],
  );
}
