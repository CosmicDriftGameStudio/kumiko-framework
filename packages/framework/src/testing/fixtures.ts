import { buildDrizzleTable } from "../db/table-builder";
import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
} from "../engine/factories";
import type { SessionUser, TenantId } from "../engine/types";

// Zero-padded UUIDs used across the test suite. `testTenantId(1)` /
// `testUserId(1)` read cleaner in assertions than the full UUID literals,
// and keep all tests on a single shape — if the UUID layout ever changes,
// it changes here.
export function testTenantId(n: number): TenantId {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

// Distinct prefix from tenantId so debug output visibly differentiates the
// two when a user-id accidentally lands in a tenant-id slot.
export function testUserId(n: number): string {
  return `11111111-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

export const TestUsers = {
  admin: { id: testUserId(1), tenantId: testTenantId(1), roles: ["Admin"] },
  systemAdmin: { id: testUserId(1), tenantId: testTenantId(1), roles: ["SystemAdmin"] },
  user: { id: testUserId(2), tenantId: testTenantId(1), roles: ["User"] },
  driver: { id: testUserId(3), tenantId: testTenantId(1), roles: ["Driver"] },
  otherTenant: { id: testUserId(10), tenantId: testTenantId(2), roles: ["Admin"] },
} as const satisfies Record<string, SessionUser>;

// Accept numeric shortcuts for legacy call sites — stringify to a UUID so the
// SessionUser type stays aligned. `createTestUser({ id: 42 })` gives you
// `testUserId(42)`. Explicit strings pass through untouched.
export function createTestUser(
  overrides?: Partial<Omit<SessionUser, "id">> & { id?: string | number },
): SessionUser {
  const normalizedId =
    typeof overrides?.id === "number"
      ? testUserId(overrides.id)
      : (overrides?.id ?? TestUsers.admin.id);
  const { id: _id, ...rest } = overrides ?? {};
  return { ...TestUsers.admin, ...rest, id: normalizedId };
}

// --- Shared Entity Fixtures -------------------------------------------------
//
// Replaces inline `createEntity(...) + buildDrizzleTable(...)` boilerplate
// that appeared in 20+ integration tests. Pick the shape closest to what
// the test needs; if a feature needs extras (hooks, state-machine, fields),
// keep a local inline entity rather than bloating these shared ones.

// "Just a name" — minimal entity with `name: text`, softDelete on.
// Used by every pipeline test that only needs SOMETHING to write events
// against (event-dispatcher*, event-retention, event-dedup, …).
export const sharedWidgetEntity = createEntity({
  fields: { name: createTextField({ required: true }) },
  softDelete: true,
});
export const sharedWidgetTable = buildDrizzleTable("widget", sharedWidgetEntity);

// User with searchable name/email fields. Used by full-stack, cascade,
// and any test that exercises search-indexing or field-access on a
// realistic-looking user record.
export const sharedUserEntity = createEntity({
  fields: {
    email: createTextField({ required: true, format: "email", searchable: true }),
    firstName: createTextField({ searchable: true }),
    lastName: createTextField({ searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
  searchWeight: 10,
});
export const sharedUserTable = buildDrizzleTable("user", sharedUserEntity);

// Item with name + optional price. Used by error-contract, batch,
// projection-rebuild — tests that need "a thing you can CRUD".
export const sharedItemEntity = createEntity({
  fields: {
    name: createTextField({ required: true }),
    price: createNumberField(),
  },
  softDelete: true,
});
export const sharedItemTable = buildDrizzleTable("item", sharedItemEntity);
