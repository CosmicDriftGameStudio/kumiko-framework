import type { AnyDb } from "../query";
import { asRawClient } from "../query";

/** Stabiler Lock-Key für pg_advisory_xact_lock — multi-replica seed boots. */
export const ES_OPS_ADVISORY_LOCK_KEY = 0x65_73_6f_70; // 'esop'

export async function acquireEsOpsAdvisoryLock(db: AnyDb): Promise<void> {
  await asRawClient(db).unsafe(`SELECT pg_advisory_xact_lock($1)`, [ES_OPS_ADVISORY_LOCK_KEY]);
}

export async function esOperationExists(db: AnyDb, operationId: string): Promise<boolean> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT 1 FROM "kumiko_es_operations" WHERE id = $1 LIMIT 1`,
    [operationId],
  )) as readonly unknown[];
  return rows.length > 0;
}
