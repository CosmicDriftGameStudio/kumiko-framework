import {
  bigint,
  type EntityTableMeta,
  index,
  instant,
  integer,
  table as pgTable,
  primaryKey,
  requireEntityTableMeta,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

const CAP_RESERVATIONS_TENANT_CAP_EXPIRES_INDEX =
  "store_cap_reservations_tenant_id_cap_name_expires_at_idx";

// One row per capacity that was booked before a handler transaction and is not settled yet. The
// handler transaction deletes it on its own commit (confirm). While a calendar row is open the
// counter holds amount + consumed_amount for it. A release or the TTL sweep gives back amount and
// keeps the row as a released tombstone (released_at set, amount 0, consumed_amount still booked)
// until its shortened TTL passes, so a later consume or settle accounts for the consumed units.
// A settle keeps the row as a settled tombstone (settled_at set) the same way, so a repeated settle
// or a late release finds it and does nothing.
// Unmanaged: the rows are a coordination aid, not state with an event history.
// kind only knows "calendar"; the column stays because existing tables have it NOT NULL without default.
export const capReservationsTable = pgTable(
  "store_cap_reservations",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    capName: text("cap_name").notNull(),
    kind: text("kind").notNull().$type<"calendar">(),
    // Calendar only: raw string the counter's aggregate id was derived from; a normalized instant could point at another counter.
    periodStartIso: text("period_start_iso"),
    amount: integer("amount").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
    settledAt: instant("settled_at"),
    consumedAmount: integer("consumed_amount").notNull().default(0),
    releasedAt: instant("released_at"),
  },
  (t) => [index(CAP_RESERVATIONS_TENANT_CAP_EXPIRES_INDEX).on(t.tenantId, t.capName, t.expiresAt)],
);

export const capReservationsTableMeta: EntityTableMeta = requireEntityTableMeta(
  capReservationsTable,
  "capReservationsTable",
);

// One row per (tenant, cap, UTC hour): increment-rolling adds to the row of the current hour,
// readRollingCapUsage sums the rows of the window. Unmanaged coordination store, no event history.
export const rollingCapUsageTable = pgTable(
  "store_cap_rolling_usage",
  {
    tenantId: uuid("tenant_id").notNull(),
    capName: text("cap_name").notNull(),
    bucketStart: instant("bucket_start").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "store_cap_rolling_usage_pkey",
      columns: [t.tenantId, t.capName, t.bucketStart],
    }),
    // Retention delete on increment filters tenant + bucket_start only.
    index("store_cap_rolling_usage_tenant_id_bucket_start_idx").on(t.tenantId, t.bucketStart),
  ],
);

export const rollingCapUsageTableMeta: EntityTableMeta = requireEntityTableMeta(
  rollingCapUsageTable,
  "rollingCapUsageTable",
);
