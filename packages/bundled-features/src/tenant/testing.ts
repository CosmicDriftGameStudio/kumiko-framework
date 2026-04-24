// Testing helpers for the tenant feature. `seedMembership` replaces the
// pre-ES pattern of `db.insert(tenantMembershipsTable).values({...})` in
// test fixtures — a direct-write bypasses the event-store executor, so
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

import { createEventStoreExecutor, type DbConnection } from "@kumiko/framework/db";
import type { SessionUser, TenantId } from "@kumiko/framework/engine";
import { TestUsers } from "@kumiko/framework/testing";
import { tenantMembershipEntity, tenantMembershipsTable } from "./membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenantMembership",
});

export type SeedMembershipOptions = {
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

/**
 * Seed a tenant membership through the event-store executor. Writes
 * both an `tenantMembership.created` event and the corresponding
 * projection row in one transaction — identical effect to
 * `TenantHandlers.addMember`, minus the access-check.
 */
export async function seedMembership(
  db: DbConnection,
  options: SeedMembershipOptions,
): Promise<void> {
  const by = options.by ?? TestUsers.systemAdmin;
  // Executor wants TenantDb. The test-stack hands out a plain DbConnection
  // from `stack.db.db`; wrap on the fly into a system-scoped TenantDb so
  // the insert respects the tenant-override (we write into options.tenantId,
  // which may differ from `by.tenantId`).
  const { createTenantDb } = await import("@kumiko/framework/db");
  const tdb = createTenantDb(db, by.tenantId, "system");
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
      `seedMembership failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
}
