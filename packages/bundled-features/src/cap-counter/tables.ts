import {
  defineUnmanagedTable,
  type EntityTableMeta,
  index,
  instant,
  integer,
  table as pgTable,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

const CAP_RESERVATIONS_TENANT_CAP_EXPIRES_INDEX =
  "store_cap_reservations_tenant_id_cap_name_expires_at_idx";

// One row per capacity that was booked before a handler transaction and is not settled yet. The
// handler transaction deletes it on its own commit (confirm); a release or the TTL sweep deletes it
// together with the counter decrement. Unmanaged: the rows are a coordination aid, not state with
// an event history.
export const capReservationsTable = pgTable(
  "store_cap_reservations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    capName: text("cap_name").notNull(),
    kind: text("kind").notNull().$type<"calendar" | "rolling">(),
    // Calendar only: raw string the counter's aggregate id was derived from; a normalized instant could point at another counter.
    periodStartIso: text("period_start_iso"),
    amount: integer("amount").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [index(CAP_RESERVATIONS_TENANT_CAP_EXPIRES_INDEX).on(t.tenantId, t.capName, t.expiresAt)],
);

export const capReservationsTableMeta: EntityTableMeta = defineUnmanagedTable({
  tableName: "store_cap_reservations",
  indexes: [
    {
      name: CAP_RESERVATIONS_TENANT_CAP_EXPIRES_INDEX,
      columns: ["tenant_id", "cap_name", "expires_at"],
    },
  ],
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "cap_name", pgType: "text", notNull: true },
    { name: "kind", pgType: "text", notNull: true },
    { name: "period_start_iso", pgType: "text", notNull: false },
    { name: "amount", pgType: "integer", notNull: true },
    { name: "expires_at", pgType: "timestamptz", notNull: true },
    { name: "created_at", pgType: "timestamptz", notNull: true },
  ],
});
