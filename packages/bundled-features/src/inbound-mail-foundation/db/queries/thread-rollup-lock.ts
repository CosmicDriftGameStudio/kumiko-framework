// Raw SQL helper for the thread-rollup lock (issue #2155), see inbound-projections.ts.

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

// Namespaced two-int form keeps this per-thread key space disjoint from
// the framework's other fixed-key advisory locks (schema bootstrap, es-ops
// boot) that live in the default single-int space. 'inbm' as ASCII.
const THREAD_ROLLUP_LOCK_NAMESPACE = 0x696e626d;

/** pg_advisory_xact_lock keyed on threadAggId — xact-scoped, auto-released at commit/rollback. */
export async function acquireThreadRollupLock(tx: DbRunner, threadAggId: string): Promise<void> {
  await asRawClient(tx).unsafe("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    THREAD_ROLLUP_LOCK_NAMESPACE,
    threadAggId,
  ]);
}
