import {
  boolean,
  buildBaseColumns,
  instant,
  table as pgTable,
  serial,
  text,
  uniqueIndex,
  uuid,
} from "@kumiko/framework/db";
import {
  createBooleanField,
  createEntity,
  createSelectField,
  createTextField,
} from "@kumiko/framework/engine";
import { sql } from "drizzle-orm";

// Delivery-log is an append-only stream of per-attempt records. Post-ES
// the stream of truth lives in the events-Tabelle (one aggregate per
// attempt, event type `delivery:event:attempt`). An INLINE projection
// materialises each event into a row of deliveryLogTable for the
// log-query handler — same TX as the event-append, so callers can read
// their own writes synchronously.
//
// `deliveryAttemptEntity` below is the source anchor for the projection:
// r.projection requires a registered entity as `source`, but this entity
// has no CRUD lifecycle (no executor, no table-push). The real read-model
// is deliveryLogTable. The entity is a shape-anchor only.
// Shape-anchor entity for the delivery-log projection. Never instantiated
// (no table is pushed for `delivery_attempts` — the name in `table:` below
// is a placeholder the framework needs at registration time). Events with
// aggregateType "deliveryAttempt" flow through low-level append() and the
// inline-projection on this entity writes the corresponding row into
// deliveryLogTable.
export const deliveryAttemptEntity = createEntity({
  table: "delivery_attempts",
  idType: "uuid",
  fields: {
    notificationType: createTextField({ required: true }),
    channel: createTextField({ required: true }),
    status: createSelectField({
      required: true,
      options: ["sent", "failed", "skipped"],
    }),
  },
});

export const deliveryLogTable = pgTable("delivery_logs", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  notificationType: text("notification_type").notNull(),
  channel: text("channel").notNull(),
  // User-IDs as UUID-strings post-ES migration.
  recipientId: text("recipient_id"),
  recipientAddress: text("recipient_address"),
  status: text("status").notNull().$type<"sent" | "failed" | "skipped">(),
  error: text("error"),
  createdAt: instant("created_at").default(sql`now()`).notNull(),
});

// User-scoped opt-in/opt-out for (notificationType, channel) pairs. Post-ES
// refactor: each row is a notificationPreference aggregate with
// `.created / .updated / .deleted` lifecycle events written via the
// event-store executor. The unique index on (tenant, user, type, channel)
// is the effective natural key; the uuid PK is the aggregate id.
export const notificationPreferenceEntity = createEntity({
  table: "notification_preferences",
  idType: "uuid",
  fields: {
    userId: createTextField({ required: true }),
    notificationType: createTextField({ required: true }), // qualified name or "*"
    channel: createTextField({ required: true }), // "inApp", "email", "push", or "*"
    enabled: createBooleanField({ default: true }),
  },
});

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    ...buildBaseColumns(false, "uuid"),
    userId: text("user_id").notNull(),
    notificationType: text("notification_type").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
  },
  (table) => [
    uniqueIndex("notification_pref_unique").on(
      table.tenantId,
      table.userId,
      table.notificationType,
      table.channel,
    ),
  ],
);
