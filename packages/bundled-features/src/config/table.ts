import { buildBaseColumns, table as pgTable, text, uniqueIndex } from "@kumiko/framework/db";
import { createEntity, createTextField } from "@kumiko/framework/engine";

// Config values are event-sourced. Each (key, scope) is its own aggregate
// stream — lifecycle events `configValue.created / .updated / .deleted`
// flow through createEventStoreExecutor, which writes the stream + this
// projection in one TX. Reads stay O(1) against the projection.
//
// System-scope rows use SYSTEM_TENANT_ID (not null) — buildBaseColumns
// forces tenant_id NOT NULL, so the pre-ES "NULL means system" convention
// is replaced with a fixed sentinel. The unique index stays on
// (key, tenant_id, user_id) to prevent duplicate writes at the DB level.
export const configValueEntity = createEntity({
  table: "read_config_values",
  fields: {
    key: createTextField({ required: true }),
    // value is JSON-encoded primitive (or encrypted blob). Nullable so a
    // deleted-then-recreated stream can signal "reset to default" without
    // breaking the null-vs-missing distinction the resolver already draws.
    value: createTextField({}),
    // user-scope row: userId populated. tenant- / system-scope: null.
    userId: createTextField({}),
  },
});

export const configValuesTable = pgTable(
  "read_config_values",
  {
    ...buildBaseColumns(false, "uuid"),
    key: text("key").notNull(),
    value: text("value"),
    userId: text("user_id"),
  },
  (table) => [uniqueIndex("read_config_values_unique").on(table.key, table.tenantId, table.userId)],
);
