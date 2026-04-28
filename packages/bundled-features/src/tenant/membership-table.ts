import { buildDrizzleTable } from "@kumiko/framework/db";
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
//
// Single-Source-of-Truth: `tenantMembershipEntity`. Die DB-Tabelle wird
// aus der EntityDefinition über buildDrizzleTable abgeleitet, der
// unique-Index ist via entity.indexes deklariert.
export const tenantMembershipEntity = createEntity({
  table: "read_tenant_memberships",
  fields: {
    userId: createTextField({ required: true }),
    // JSON-encoded string[] — parseRoles() deserializes at read time.
    // Mirrors how roles were stored under the pre-ES row model so the
    // read-side stays byte-compatible and no MSP/consumer needs rewrites.
    roles: createTextField({ required: true }),
  },
  indexes: [
    { unique: true, columns: ["userId", "tenantId"], name: "read_tenant_memberships_unique" },
  ],
});

export const tenantMembershipsTable = buildDrizzleTable(
  "tenant-membership",
  tenantMembershipEntity,
);
