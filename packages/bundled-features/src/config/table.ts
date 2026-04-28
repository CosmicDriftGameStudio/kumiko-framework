import { buildDrizzleTable } from "@kumiko/framework/db";
import { createEntity, createTextField } from "@kumiko/framework/engine";

// Config values are event-sourced. Each (key, scope) is its own aggregate
// stream — lifecycle events `configValue.created / .updated / .deleted`
// flow through createEventStoreExecutor, which writes the stream + this
// projection in one TX. Reads stay O(1) against the projection.
//
// System-scope rows use SYSTEM_TENANT_ID (not null) — buildBaseColumns
// (via buildDrizzleTable) forces tenant_id NOT NULL, so die pre-ES "NULL
// means system" convention is replaced with a fixed sentinel. Der unique
// index über (key, tenant_id, user_id) prevent duplicate writes at the DB
// level — deklariert via entity.indexes.
//
// Single-Source-of-Truth: nur `configValueEntity`. Frühere parallele
// hand-written `configValuesTable` ist eliminiert (drift-prone). Die
// Drizzle-Table wird zur Laufzeit/Migration über buildDrizzleTable
// generiert und als named export `configValuesTable` (plural) für
// rückwärtskompatible Imports aus App-Code re-exportiert.
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
  indexes: [
    { unique: true, columns: ["key", "tenantId", "userId"], name: "read_config_values_unique" },
  ],
});

export const configValuesTable = buildDrizzleTable("config-value", configValueEntity);
