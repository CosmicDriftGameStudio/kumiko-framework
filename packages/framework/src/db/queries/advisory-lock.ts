import type { AnyDb } from "../query";
import { asRawClient } from "../query";

/** pg_advisory_xact_lock keyed on namespace+key hash — xact-scoped, auto-released at commit/rollback. */
export async function acquireNamespacedAdvisoryLock(
  db: AnyDb,
  namespace: number,
  key: string,
): Promise<void> {
  await asRawClient(db).unsafe(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [namespace, key]);
}
