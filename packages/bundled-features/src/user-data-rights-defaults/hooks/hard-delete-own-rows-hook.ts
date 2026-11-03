import type { UserDataDeleteHook, UserDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { featureMounted } from "./feature-mounted.ts";

type OwnRowsTable = Parameters<UserDataHookCtx["db"]["deleteMany"]>[0];

// Unmanaged direct-write stores (no event stream): a direct DELETE is rebuild-safe.
export function hardDeleteOwnRowsDeleteHook(source: {
  readonly featureName: string;
  readonly table: OwnRowsTable;
}): UserDataDeleteHook {
  const { featureName, table } = source;
  return async (ctx) => {
    // skip: source feature not mounted — its table doesn't exist, nothing to erase.
    if (!featureMounted(ctx, featureName)) return;
    await ctx.db.deleteMany(table, { userId: ctx.userId, tenantId: ctx.tenantId });
  };
}
