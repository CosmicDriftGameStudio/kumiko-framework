import { buildBaseColumns, table as pgTable, text, uniqueIndex } from "@kumiko/framework/db";
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
  table: "read_tenant_memberships",
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
  "read_tenant_memberships",
  {
    ...buildBaseColumns(false, "uuid"),
    userId: text("user_id").notNull(),
    roles: text("roles").notNull(),
  },
  (table) => [uniqueIndex("read_tenant_memberships_unique").on(table.userId, table.tenantId)],
);
