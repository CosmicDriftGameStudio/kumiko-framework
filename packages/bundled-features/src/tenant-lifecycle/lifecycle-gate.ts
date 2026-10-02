import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { tenantTable } from "../tenant/index.js";

export type TenantLifecycleGate = {
  readonly status: string;
  readonly gracePeriodEnd: string | null;
};

// Every authenticated + anonymous request consults this (via auth-middleware's
// resolveTenantLifecycleStatus) — a per-request DB round-trip otherwise.
// invalidateTenantLifecycleGate(tenantId) clears the SAME-process entry
// right after every status-changing write (request/cancel-destruction, the
// sweep, tombstoneTenantRow) — the instant-visibility path for a single
// replica. In a multi-replica deployment a write on pod A never reaches pod
// B's Map, so a short TTL bounds the cross-pod staleness window instead of
// leaving it unbounded (self-heals within GATE_TTL_MS even if invalidation
// never arrives).
// Split into its own module (not run-tenant-destroy.ts) so stages.ts can
// invalidate too without a stages.ts <-> run-tenant-destroy.ts import cycle.
// The anonymous path feeds client-supplied X-Tenant ids in here, so unknown ids
// (cached as null) must not grow the Map without bound: past the cap, expired
// entries are swept and, if still full, the oldest-inserted entries are evicted.
const GATE_TTL_MS = 3000;
/** @internal exported for the bounded-cache test */
export const GATE_CACHE_MAX_ENTRIES = 5000;
const gateCache = new Map<
  TenantId,
  { readonly value: TenantLifecycleGate | null; readonly expiresAt: number }
>();

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

/** @internal test-only */
export function tenantLifecycleGateCacheSizeForTests(): number {
  return gateCache.size;
}

function cacheGate(tenantId: TenantId, value: TenantLifecycleGate | null): void {
  if (gateCache.size >= GATE_CACHE_MAX_ENTRIES && !gateCache.has(tenantId)) {
    const now = Date.now();
    for (const [id, entry] of gateCache) {
      if (entry.expiresAt <= now) gateCache.delete(id);
    }
    for (const id of gateCache.keys()) {
      if (gateCache.size < GATE_CACHE_MAX_ENTRIES) break;
      gateCache.delete(id);
    }
  }
  gateCache.set(tenantId, { value, expiresAt: Date.now() + GATE_TTL_MS });
}

export async function resolveTenantLifecycleGate(
  db: DbRunner,
  tenantId: TenantId,
): Promise<TenantLifecycleGate | null> {
  const cached = gateCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rows = await selectMany<{ status: string; gracePeriodEnd: Temporal.Instant | null }>(
    db,
    tenantTable,
    { id: tenantId },
  );
  const row = rows[0];
  if (!row) {
    cacheGate(tenantId, null);
    return null;
  }
  const gate: TenantLifecycleGate = {
    status: row.status,
    gracePeriodEnd: row.gracePeriodEnd?.toString() ?? null,
  };
  cacheGate(tenantId, gate);
  return gate;
}
