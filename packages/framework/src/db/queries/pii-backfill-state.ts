import type { AnyDb } from "../query.js";
import { asRawClient } from "../query.js";

export type PiiBackfillStateRow = { readonly cursor: string; readonly completed: boolean };

export async function readPiiBackfillState(
  db: AnyDb,
  fingerprint: string,
): Promise<PiiBackfillStateRow | null> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT "cursor_event_id"::text AS "cursor", "completed_at" IS NOT NULL AS "completed"
       FROM "kumiko_pii_backfill_state" WHERE "fingerprint" = $1`,
    [fingerprint],
  )) as ReadonlyArray<PiiBackfillStateRow>;
  return rows[0] ?? null;
}

export async function persistPiiBackfillState(
  db: AnyDb,
  fingerprint: string,
  cursor: bigint,
  markCompleted: boolean,
): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_pii_backfill_state" ("fingerprint", "cursor_event_id", "completed_at", "updated_at")
     VALUES ($1, $2::bigint, CASE WHEN $3::boolean THEN now() ELSE NULL END, now())
     ON CONFLICT ("fingerprint") DO UPDATE SET
       "cursor_event_id" = GREATEST("kumiko_pii_backfill_state"."cursor_event_id", EXCLUDED."cursor_event_id"),
       "completed_at" = COALESCE("kumiko_pii_backfill_state"."completed_at", EXCLUDED."completed_at"),
       "updated_at" = now()`,
    [fingerprint, cursor.toString(), markCompleted],
  );
}
