import {
  boolean,
  buildBaseColumns,
  type EntityTableMeta,
  index,
  instant,
  requireEntityTableMeta,
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
const DELIVERY_ATTEMPTS_TENANT_CREATED_INDEX = "store_delivery_attempts_tenant_id_created_at_idx";
const DELIVERY_ATTEMPTS_TENANT_IDEMPOTENCY_INDEX =
  "store_delivery_attempts_tenant_id_idempotency_key_idx";

export const deliveryAttemptsTable = pgTable(
  "store_delivery_attempts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    notificationType: text("notification_type").notNull(),
    channel: text("channel").notNull(),
    // User-IDs as UUID-strings post-ES migration.
    recipientId: text("recipient_id"),
    recipientAddress: text("recipient_address"),
    status: text("status").notNull().$type<"queued" | "sent" | "failed" | "skipped">(),
    error: text("error"),
    // false = provider accepted but did not confirm; null = confirmed or not applicable.
    confirmed: boolean("confirmed"),
    // Default covers rows that predate the column; new rows always carry the
    // notify() priority from the event payload.
    priority: text("priority").notNull().default("normal").$type<"critical" | "normal" | "low">(),
    createdAt: instant("created_at").default(sql`now()`).notNull(),
    // Null for attempts of notify() calls without an idempotencyKey and for rows that predate the column.
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index(DELIVERY_ATTEMPTS_TENANT_CREATED_INDEX).on(t.tenantId, t.createdAt),
    index(DELIVERY_ATTEMPTS_TENANT_IDEMPOTENCY_INDEX).on(t.tenantId, t.idempotencyKey),
  ],
);

// Event projection without an entity: the id comes from the attempt stream and there are no
// audit or version columns. It is registered via r.storeTable because that is the only register
// for tables without an entity; the store_ prefix is the deliberate exception here.
export const deliveryAttemptsTableMeta: EntityTableMeta = requireEntityTableMeta(
  deliveryAttemptsTable,
  "deliveryAttemptsTable",
);

// User-scoped opt-in/opt-out for (notificationType, channel) pairs. Post-ES
// refactor: each row is a notificationPreference aggregate with
// `.created / .updated / .deleted` lifecycle events written via the
// event-store executor. The unique index on (tenant, user, type, channel)
// is the effective natural key; the uuid PK is the aggregate id.
export const notificationPreferenceEntity = createEntity({
  name: "notification-preference",
  table: "read_notification_preferences",
  fields: {
    userId: createTextField({ required: true, personal: false, reason: "pseudonymous_fk" }),
    notificationType: createTextField({
      required: true,
      personal: false,
      reason: "technical_reference",
    }), // qualified name or "*"
    channel: createTextField({ required: true, personal: false, reason: "technical_reference" }), // "inApp", "email", a chat channel, or "*"
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

// Opt-out for a recipient ADDRESS that has no user account (direct sends via
// `ctx.notify(type, { route: { email } })`). addressHash is a keyed HMAC
// (computeBlindIndex over the normalized address) — the plaintext address
// never reaches this entity or the token that unsubscribes it.
// A row's mere existence is the opt-out; there is no `enabled` toggle to flip.
// Resubscribing (removeAddressOptOut) hard-deletes the row instead — the
// entity has no softDelete, and a later re-opt-out for the same address
// picks the next id generation (see addressOptOutAggregateId) since the
// deleted stream can't be revived.
export const notificationAddressOptOutEntity = createEntity({
  name: "notification-address-opt-out",
  table: "read_notification_address_opt_outs",
  fields: {
    addressHash: createTextField({ required: true, personal: false, reason: "keyed_hash" }),
    notificationType: createTextField({
      required: true,
      personal: false,
      reason: "technical_reference",
    }),
    channel: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

export const notificationAddressOptOutsTable = pgTable(
  "read_notification_address_opt_outs",
  {
    ...buildBaseColumns(false, "uuid"),
    addressHash: text("address_hash").notNull(),
    notificationType: text("notification_type").notNull(),
    channel: text("channel").notNull(),
  },
  (table) => [
    uniqueIndex("read_notification_address_opt_outs_unique").on(
      table.tenantId,
      table.addressHash,
      table.notificationType,
      table.channel,
    ),
  ],
);
