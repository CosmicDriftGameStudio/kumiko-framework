import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { USER_STATUS, userEntity, userTable } from "../../user";

// #494 — Lifecycle-Mutationen der user-Entity MUESSEN als `user.updated`-Event
// laufen. Roh per updateMany geschrieben, wischt ein read_users-Rebuild sie
// weg (er replayt nur `user.created` -> status faellt auf den Default zurueck;
// gracePeriodEnd/pendingDeletionRequestId/Deleted gehen verloren = DSGVO-
// Datenverlust).
//
// Das Event MUSS in denselben (tenant_id, aggregate_id)-Stream wie
// `user.created` landen, sonst splittet das Aggregat ueber Tenants und der
// Rebuild rekonstruiert nichts. Die user-Entity laeuft `r.systemScope()`, ihre
// Events landen aber auf einem konkreten Tenant-Stream (siehe
// auth-email-password/stream-tenant.ts; Root-Cause-Fix tracked in #497). Darum:
// Rescope auf den Stream-Tenant des Users — den des `user.created`-Events,
// NICHT `event.user.tenantId` (das ist der aktive Tenant zur Lifecycle-Zeit und
// kann abweichen).
const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// `conn` ist ctx.db.raw (regulaere Handler) ODER die offene tx (forget-cleanup
// Sub-Tx) — so bleibt der Event-Append atomar mit dem umgebenden Write.
export async function updateUserLifecycle(
  conn: DbRunner,
  userId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  // user ist systemStream (#497): der Executor-Choke-Point addressiert den
  // Stream immer auf SYSTEM_TENANT_ID — ein Rescope auf die row-tenant_id
  // waere wirkungslos. "system"-Mode, damit loadById auch Legacy-Rows findet,
  // deren tenant_id noch vor dem #762-Backfill-Rebuild steht.
  const tenantDb = createTenantDb(conn, SYSTEM_TENANT_ID, "system");
  const result = await userExecutor.update(
    { id: userId, changes },
    createSystemUser(SYSTEM_TENANT_ID),
    tenantDb,
    { skipOptimisticLock: true },
  );

  if (!result.isSuccess) {
    throw new InternalError({
      message: `user lifecycle update failed for ${userId}: ${result.error.code}`,
    });
  }
}

// #494 Bestandsdaten-Reconcile: Rows, deren Lifecycle-State der alte
// raw-updateMany-Pfad gesetzt hat, haben kein `user.updated`-Event — ein
// Rebuild wuerde sie auf die `user.created`-Defaults zuruecksetzen. Diese
// Funktion emittiert pro divergenter Row ein `user.updated` mit dem aktuellen
// Live-State, sodass Event-Log und Live-Tabelle wieder uebereinstimmen.
// MUSS einmalig ueber den Bestand laufen, BEVOR eine App read_users-Rebuilds
// re-enabled. Idempotent gegen State (ein zweiter Lauf haengt ein identisches
// user.updated an — harmlos, last-write-wins beim Replay).
// ponytail: full read_users-Scan, in JS gefiltert — einmalige Migration, kein
// Index/Streaming noetig. Bei Millionen-Rows: batchen.
export type BackfillResult = {
  readonly backfilled: number;
  readonly failed: ReadonlyArray<{ readonly id: string; readonly error: string }>;
};

export async function backfillUserLifecycleEvents(conn: DbRunner): Promise<BackfillResult> {
  const rows = (await selectMany(conn, userTable, {})) as Array<{
    id: string;
    status: string;
    gracePeriodEnd: unknown;
    pendingDeletionRequestId: unknown;
  }>;

  let backfilled = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (const row of rows) {
    const divergent =
      row.status !== USER_STATUS.Active ||
      row.gracePeriodEnd != null ||
      row.pendingDeletionRequestId != null;
    if (!divergent) continue;

    // One bad row must not abort the run: the rows after it would then never
    // get their user.updated event and stay vulnerable to the rebuild wipe
    // (DSGVO-Datenverlust). Collect failures, finish the estate, report them.
    try {
      await updateUserLifecycle(conn, row.id, {
        status: row.status,
        gracePeriodEnd: row.gracePeriodEnd,
        pendingDeletionRequestId: row.pendingDeletionRequestId,
      });
      backfilled++;
    } catch (e) {
      failed.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { backfilled, failed };
}
