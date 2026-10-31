import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { configValueEntity, configValuesTable } from "../../config/index.ts";
import { featureMounted } from "./feature-mounted.ts";
import { forgetOwnRowsDeleteHook } from "./forget-own-rows-delete-hook.ts";

// userData-Hooks for config's USER-scoped rows (userId set). Tenant-/system-
// scope rows carry no per-user subject and stay untouched. Event-sourced
// entity → forget goes through the executor (rebuild replays the erasure).
// A user-scoped setting without its user is meaningless — both strategies
// purge via the forget verb, which also erases encrypted value blobs.

const crud = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

export const configValueExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "config")) return null;
  const rows = await ctx.db.selectMany<Record<string, unknown>>(configValuesTable, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "config-value",
    // value may be an encrypted blob — exported as stored; decryption is the
    // config resolver's concern and secret-backed values don't belong in the
    // bundle in plaintext.
    rows: rows.map((r) => ({ key: r["key"], value: r["value"] })),
  };
};

export const configValueDeleteHook: UserDataDeleteHook = forgetOwnRowsDeleteHook({
  featureName: "config",
  entityName: "config-value",
  table: configValuesTable,
  executor: crud,
});
