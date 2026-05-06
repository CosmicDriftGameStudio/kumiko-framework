import {
  boolean,
  buildBaseColumns,
  instant,
  table as pgTable,
  text,
  uniqueIndex,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { sql } from "drizzle-orm";

// Delivery-log is an append-only stream of per-attempt records. The stream
// of truth lives in the events-Tabelle (one aggregate per attempt, event
// type `delivery:event:attempt`). An INLINE projection materialises each
// event into a row of deliveryAttemptsTable for the log-query handler —
// same TX as the event-append, so callers can read their own writes
// synchronously. No r.entity is registered for `deliveryAttempt`: the
// boot-validator accepts events-only projection sources as long as every
// apply-key is a registered domain-event (see registry.ts).
//
// PK = event aggregate-id (uuid). Keeps the projection row linked back to
// its event stream 1:1 — same convention as jobRunsTable + tenantSecretsTable.
// Event replays stay idempotent (primary-key conflict instead of duplicate rows).
export const deliveryAttemptsTable = pgTable("read_delivery_attempts", {
  id: uuid("id").primaryKey(),
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
  table: "read_notification_preferences",
  fields: {
    userId: createTextField({ required: true }),
    notificationType: createTextField({ required: true }), // qualified name or "*"
    channel: createTextField({ required: true }), // "inApp", "email", "push", or "*"
    enabled: createBooleanField({ default: true }),
  },
});

export const notificationPreferencesTable = pgTable(
  "read_notification_preferences",
  {
    ...buildBaseColumns(false, "uuid"),
    userId: text("user_id").notNull(),
    notificationType: text("notification_type").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
  },
  (table) => [
    uniqueIndex("read_notification_preferences_unique").on(
      table.tenantId,
      table.userId,
      table.notificationType,
      table.channel,
    ),
  ],
);
