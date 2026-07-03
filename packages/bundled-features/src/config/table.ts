import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";

// Config values are event-sourced. Each (key, scope) is its own aggregate
// stream — lifecycle events `configValue.created / .updated / .deleted`
// flow through createEventStoreExecutor, which writes the stream + this
// projection in one TX. Reads stay O(1) against the projection.
//
// System-scope rows use SYSTEM_TENANT_ID (not null) — buildBaseColumns
// (via buildEntityTable) forces tenant_id NOT NULL, so die pre-ES "NULL
// means system" convention is replaced with a fixed sentinel. Der unique
// index über (key, tenant_id, user_id) prevent duplicate writes at the DB
// level — deklariert via entity.indexes.
//
// Single-Source-of-Truth: `configValueEntity`. Die DB-Tabelle wird über
// buildEntityTable aus der EntityDefinition abgeleitet, der unique-Index
// ist via entity.indexes deklariert. Plural-Re-Export `configValuesTable`
// dient handlers (`reset.write.ts` etc.) als typisierte Drizzle-Table-Ref.
export const configValueEntity = createEntity({
  table: "read_config_values",
  fields: {
    key: createTextField({ required: true }),
    // value is JSON-encoded primitive (or encrypted blob). Nullable so a
    // deleted-then-recreated stream can signal "reset to default" without
    // breaking the null-vs-missing distinction the resolver already draws.
    value: createTextField({}),
    // user-scope row: userId populated. tenant- / system-scope: null.
    userId: createTextField({ allowPlaintext: "pseudonymous-fk" }),
  },
  indexes: [
    { unique: true, columns: ["key", "tenantId", "userId"], name: "read_config_values_unique" },
  ],
});

export const configValuesTable = buildEntityTable("config-value", configValueEntity);
