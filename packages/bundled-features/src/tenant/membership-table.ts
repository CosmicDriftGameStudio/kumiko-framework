import { buildBaseColumns, table as pgTable, text, uniqueIndex } from "@kumiko/framework/db";
import type { WriteResult } from "@kumiko/framework/engine";
import { createEntity, createTextField } from "@kumiko/framework/engine";

// Membership is event-sourced. Each (userId, tenantId) pair is its own
// aggregate stream — lifecycle events `tenantMembership.created /
// .updated / .deleted` flow through createEventStoreExecutor, which writes
// the stream + this projection in one TX. Queries read straight from the
// projection.
//
// UUID PK is mandatory for the event-store (aggregateId is uuid). The
// unique index on (userId, tenantId) stays — it was the effective PK under
// the old serial-id design and keeps duplicate-write protection at the
// database level independent of the handler lookup.
export const tenantMembershipEntity = createEntity({
  table: "tenant_memberships",
  idType: "uuid",
  fields: {
    userId: createTextField({ required: true }),
    // JSON-encoded string[] — parseRoles() deserializes at read time.
    // Mirrors how roles were stored under the pre-ES row model so the
    // read-side stays byte-compatible and no MSP/consumer needs rewrites.
    roles: createTextField({ required: true }),
  },
});

export const tenantMembershipsTable = pgTable(
  "tenant_memberships",
  {
    ...buildBaseColumns(false, "uuid"),
    userId: text("user_id").notNull(),
    roles: text("roles").notNull(),
  },
  (table) => [uniqueIndex("tenant_memberships_unique").on(table.userId, table.tenantId)],
);

// Preserve the pre-ES response shape: membership handlers previously
// returned `{userId, tenantId}` (and variants). The executor now wraps
// that in a SaveContext/DeleteContext envelope, but callers (admin UI,
// tests, downstream features) are keyed to the flat shape. `withResponseData`
// forwards failures unchanged and substitutes the success payload — one
// line per handler instead of three identical ones.
export function withResponseData<T>(result: WriteResult<unknown>, data: T): WriteResult<T> {
  if (!result.isSuccess) return result;
  return { isSuccess: true, data };
}
