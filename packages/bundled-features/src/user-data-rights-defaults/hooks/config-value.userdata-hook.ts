import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { configValueEntity, configValuesTable } from "../../config";
import { featureMounted } from "./feature-mounted";

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
  const rows = await selectMany<Record<string, unknown>>(ctx.db, configValuesTable, {
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

export const configValueDeleteHook: UserDataDeleteHook = async (ctx) => {
  // skip: config not mounted — its table doesn't exist, nothing to erase.
  if (!featureMounted(ctx, "config")) return;
  const systemUser = createSystemUser(ctx.tenantId);
  const tdb = createTenantDb(ctx.db, ctx.tenantId, "system");
  const rows = await selectMany<Record<string, unknown>>(ctx.db, configValuesTable, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  for (const row of rows) {
    const id = row["id"]; // @cast-boundary db-row
    if (typeof id !== "string") continue;
    await crud.forget({ id }, systemUser, tdb);
  }
};
