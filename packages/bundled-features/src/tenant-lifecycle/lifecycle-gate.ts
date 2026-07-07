import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { tenantTable } from "../tenant";

export type TenantLifecycleGate = {
  readonly status: string;
  readonly gracePeriodEnd: string | null;
};

// Every authenticated + anonymous request consults this (via auth-middleware's
// resolveTenantLifecycleStatus) — a per-request DB round-trip otherwise. No
// TTL: status must be observable the instant it changes (a stale "active"
// read after tombstoning would let a request slip through the 410 gate), so
// this is invalidated explicitly by every status-changing write —
// request/cancel-destruction, the sweep, and tombstoneTenantRow all call
// invalidateTenantLifecycleGate(tenantId) right after their update succeeds.
// Split into its own module (not run-tenant-destroy.ts) so stages.ts can
// invalidate too without a stages.ts <-> run-tenant-destroy.ts import cycle.
// ponytail: unbounded Map — fine while tenant counts stay in the thousands (a
// few bytes/entry); swap for a bounded LRU if that ever changes.
const gateCache = new Map<TenantId, TenantLifecycleGate | null>();

export function invalidateTenantLifecycleGate(tenantId: TenantId): void {
  gateCache.delete(tenantId);
}

/** @internal test-only — resetTestTables/resetTestTable wipe rows directly
 *  via SQL, bypassing the write handlers that invalidate normally. Tests
 *  that reset tenantTable (and reuse a fixed tenantId across cases) must
 *  call this in beforeEach or a later test can read an earlier test's
 *  cached status for the same tenantId. */
export function resetTenantLifecycleGateCacheForTests(): void {
  gateCache.clear();
}

export async function resolveTenantLifecycleGate(
  db: DbRunner,
  tenantId: TenantId,
): Promise<TenantLifecycleGate | null> {
  if (gateCache.has(tenantId)) return gateCache.get(tenantId) ?? null;
  const rows = await selectMany<{ status: string; gracePeriodEnd: Temporal.Instant | null }>(
    db,
    tenantTable,
    { id: tenantId },
  );
  const row = rows[0];
  if (!row) {
    gateCache.set(tenantId, null);
    return null;
  }
  const gate: TenantLifecycleGate = {
    status: row.status,
    gracePeriodEnd: row.gracePeriodEnd?.toString() ?? null,
  };
  gateCache.set(tenantId, gate);
  return gate;
}
