// Testing helpers for the tenant feature. `seedTenantMembership` replaces
// the pre-ES pattern of `db.insert(tenantMembershipsTable).values({...})`
// in test fixtures — a direct-write bypasses the event-store executor, so
// seeded memberships have no stream, no `.created` event, and projections
// that consume membership events stay empty.
//
// The helper runs through the executor (same TX-semantics as the
// add-member handler), which means fixtures are event-sourced end-to-end:
//   - events table gets a `tenantMembership.created` row
//   - projection row (tenant_memberships) is written in the same TX
//   - consumers (MSPs, audit) see the event just like a real call would
//
// Why this lives in bundled-features/tenant/testing rather than
// framework/testing: the helper closes over `tenantMembershipEntity` +
// `tenantMembershipsTable`, both owned by this feature. framework/testing
// stays shape-independent.
//
// Why not "just call the addMember handler via stack.http.writeOk":
//   1. Handler requires SystemAdmin — test fixtures often seed OTHER users
//      before any admin exists, so the handler would 403.
//   2. Handler goes through HTTP → JWT mint → dispatcher. Overhead for
//      fixture state-setup that the test doesn't exercise.
// The executor path skips access-checks by design (no HTTP, no JWT — this
// IS a test fixture, not a user request) while still producing the
// correct event + projection.
//
// Idempotent: calling twice for the same (userId, tenantId) is a no-op on
// the second call. Test fixtures that seed the same membership across
// `beforeEach` runs don't need explicit cleanup. A real `addMember` handler
// returns ConflictError on duplicates — that's the user-facing contract.
// Fixture-seeding prioritises "make the state exist" over "detect duplicate
// seeding", which is usually a test-author bug we don't need to surface.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@kumiko/framework/db";
import type { SessionUser, TenantId } from "@kumiko/framework/engine";
import { TestUsers } from "@kumiko/framework/testing";
import { eq } from "drizzle-orm";
import { tenantMembershipEntity, tenantMembershipsTable } from "./membership-table";
import { tenantEntity, tenantTable } from "./tenant-entity";

const tenantExecutor = createEventStoreExecutor(tenantTable, tenantEntity, {
  entityName: "tenant",
});

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenantMembership",
});

export type SeedTenantMembershipOptions = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly roles: readonly string[];
  /**
   * SessionUser to bill the event against (goes into event.metadata.userId +
   * the projection's inserted_by_id column). Defaults to TestUsers.systemAdmin
   * — mirrors the real call-path, where add-member is SystemAdmin-only.
   */
  readonly by?: SessionUser;
};

export type SeedTenantOptions = {
  /** Stable UUID — required for fixtures so the FE/BE können dieselbe ID
   *  hardcoden (Sample-Switcher zeigt den Tenant beim Namen, der Test
   *  prüft Memberships gegen exakt diese ID). Ohne ID müsste der Caller
   *  den lookup-by-key extra machen. */
  readonly id: TenantId;
  /** URL-/Slug-Form (z.B. "dev", "acme"). Indexed unique in der DB. */
  readonly key: string;
  /** Human-readable label (im Switcher angezeigt). */
  readonly name: string;
  readonly by?: SessionUser;
};

/**
 * Seed a tenant through the event-store executor. Idempotent: a second
 * call for the same `id` is a no-op. Same TX-semantics as the real
 * `TenantHandlers.create`, minus the SystemAdmin-access-check and minus
 * ConflictError-on-duplicate.
 */
export async function seedTenant(db: DbConnection, options: SeedTenantOptions): Promise<TenantId> {
  const by = options.by ?? TestUsers.systemAdmin;
  // executor.create erwartet eine TenantDb (mit .insert()-API), nicht
  // die rohe DbConnection. Auch wenn das Tenant-Aggregat selbst NICHT
  // tenant-scoped ist, braucht der Wrap-Layer für die runtime-API zu
  // existieren. by.tenantId reicht — keine Override-Semantik wie bei
  // seedTenantMembership nötig.
  const tdb = createTenantDb(db, by.tenantId, "system");

  const existing = await fetchOne(db, tenantTable, eq(tenantTable["id"], options.id));
  if (existing) return options.id;

  const result = await tenantExecutor.create(
    { id: options.id, key: options.key, name: options.name },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(
      `seedTenant failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
  return options.id;
}

/**
 * Seed a tenant membership through the event-store executor. Writes
 * both a `tenantMembership.created` event and the corresponding
 * projection row in one transaction — identical effect to
 * `TenantHandlers.addMember`, minus the access-check and minus the
 * ConflictError on duplicates (duplicate calls no-op).
 */
export async function seedTenantMembership(
  db: DbConnection,
  options: SeedTenantMembershipOptions,
): Promise<void> {
  const by = options.by ?? TestUsers.systemAdmin;
  // Wrap into a system-scoped TenantDb so the insert respects the tenant-
  // override (we write into options.tenantId, which may differ from by.tenantId).
  const tdb = createTenantDb(db, by.tenantId, "system");

  // Idempotency: duplicate seeds are common across beforeEach-resets where
  // only certain tables get truncated. A plain executor.create would trip
  // the (user_id, tenant_id) unique index; the fixture call-site would then
  // have to juggle try/catch. Lookup-first keeps call-sites clean.
  const existing = await fetchOne(
    db,
    tenantMembershipsTable,
    eq(tenantMembershipsTable.userId, options.userId),
    eq(tenantMembershipsTable.tenantId, options.tenantId),
  );
  // skip: idempotent no-op — duplicate seed is expected across beforeEach-
  // resets that don't truncate this table. Cheaper than try/catch on the
  // unique-index, and documented in the function JSDoc above.
  if (existing) return;

  const result = await executor.create(
    {
      userId: options.userId,
      tenantId: options.tenantId,
      roles: JSON.stringify(options.roles),
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(
      `seedTenantMembership failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
}
