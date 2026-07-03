import {
  boolean,
  buildBaseColumns,
  defineUnmanagedTable,
  type EntityTableMeta,
  instant,
  table as pgTable,
  sql,
  text,
  uniqueIndex,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

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
  status: text("status").notNull().$type<"queued" | "sent" | "failed" | "skipped">(),
  error: text("error"),
  // Default covers rows that predate the column; new rows always carry the
  // notify() priority from the event payload.
  priority: text("priority").notNull().default("normal").$type<"critical" | "normal" | "low">(),
  createdAt: instant("created_at").default(sql`now()`).notNull(),
});

// **Unmanaged table** — bewusst KEIN createEntity. Begründung:
//   - id kommt aus dem Aggregate-Stream (kein gen_random_uuid()-DEFAULT)
//   - kein version/inserted_by/modified_by/modified_at — keine in-place-
//     Edits, keine Audit-Spalten nötig (idempotent-on-replay via PK-Konflikt)
//   - created_at statt inserted_at — historischer Naming-Drift, kein Bug
// App trägt Verantwortung für tenant-scoping in Queries + replay-idempotency.
// pgTable bleibt source-of-truth für Query-API; Phase 4 leitet das pgTable
// aus dieser Meta ab.
export const deliveryAttemptsTableMeta: EntityTableMeta = defineUnmanagedTable({
  tableName: "read_delivery_attempts",
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "notification_type", pgType: "text", notNull: true },
    { name: "channel", pgType: "text", notNull: true },
    { name: "recipient_id", pgType: "text", notNull: false },
    { name: "recipient_address", pgType: "text", notNull: false },
    { name: "status", pgType: "text", notNull: true },
    { name: "error", pgType: "text", notNull: false },
    { name: "priority", pgType: "text", notNull: true, defaultSql: "'normal'" },
    { name: "created_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
  ],
});

// User-scoped opt-in/opt-out for (notificationType, channel) pairs. Post-ES
// refactor: each row is a notificationPreference aggregate with
// `.created / .updated / .deleted` lifecycle events written via the
// event-store executor. The unique index on (tenant, user, type, channel)
// is the effective natural key; the uuid PK is the aggregate id.
export const notificationPreferenceEntity = createEntity({
  table: "read_notification_preferences",
  fields: {
    userId: createTextField({ required: true, pii: true }),
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
