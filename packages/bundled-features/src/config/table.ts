import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";

// Config values are event-sourced. Each (key, scope) is its own aggregate
// stream — lifecycle events `configValue.created / .updated / .deleted`
// flow through createEventStoreExecutor, which writes the stream and this
// projection in one TX. Reads remain O(1) against the projection.
//
// System-scope rows use SYSTEM_TENANT_ID (not null) — buildBaseColumns
// (via buildEntityTable) forces tenant_id NOT NULL, so the pre-ES "NULL
// means system" convention is replaced with a fixed sentinel. The unique
// index on (key, tenant_id, user_id) prevents duplicate writes at the DB
// level — declared via entity.indexes.
//
// Single source of truth: `configValueEntity`. The DB table is derived from
// the EntityDefinition through buildEntityTable, and the unique index is
// declared via entity.indexes. The plural re-export `configValuesTable`
// provides handlers (`reset.write.ts` etc.) with a typed Drizzle table ref.
export const configValueEntity = createEntity({
  table: "read_config_values",
  fields: {
    key: createTextField({ required: true, personal: false, reason: "system_metadata" }),
    // value is JSON-encoded primitive (or encrypted blob). Nullable so a
    // deleted-then-recreated stream can signal "reset to default" without
    // breaking the null-vs-missing distinction the resolver already draws.
    // App/system/tenant config values (service urls, feature toggles,
    // mail-server settings), not user-authored content.
    value: createTextField({ personal: false, reason: "system_metadata" }),
    // user-scope row: userId populated. tenant- / system-scope: null.
    userId: createTextField({
      personal: false,
      reason: "pseudonymous_fk",
    }),
  },
  indexes: [
    { unique: true, columns: ["key", "tenantId", "userId"], name: "read_config_values_unique" },
  ],
});

export const configValuesTable = buildEntityTable("config-value", configValueEntity);
