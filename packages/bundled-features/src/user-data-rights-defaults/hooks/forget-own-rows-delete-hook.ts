import type { EventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { collectErasureFailure, throwIfErasureFailed } from "../../shared/index.ts";
import { featureMounted } from "./feature-mounted.ts";

type OwnRowsTable = Parameters<UserDataHookCtx["db"]["selectMany"]>[0];

// Forgets (Art. 17, via the executor so a rebuild replays it) every row naming the user in any owner
// field, trashed rows included, under both strategies: only for rows that belong wholly to those users.
export function forgetOwnRowsDeleteHook(source: {
  readonly entityName: string;
  readonly table: OwnRowsTable;
  readonly executor: Pick<EventStoreExecutor, "forget">;
  /** Columns holding the erased user's id; a row matching any of them is forgotten. Defaults to `["userId"]`. */
  readonly ownerFields?: readonly [string, ...string[]];
  /** Optional source feature: the hook is a no-op while it is not mounted (its table does not exist). */
  readonly featureName?: string;
}): UserDataDeleteHook {
  const { featureName, entityName, table, executor } = source;
  const ownerFields = source.ownerFields ?? ["userId"];
  return async (ctx) => {
    // skip: source feature not mounted — its table doesn't exist, nothing to erase.
    if (featureName !== undefined && !featureMounted(ctx, featureName)) return;
    const systemUser = createSystemUser(ctx.tenantId);
    const ids = new Set<string>();
    for (const ownerField of ownerFields) {
      const rows = await ctx.db.selectMany<{ readonly id: unknown }>(
        table,
        { tenantId: ctx.tenantId, [ownerField]: ctx.userId },
        { fields: ["id"] },
      );
      for (const row of rows) {
        if (typeof row.id === "string") ids.add(row.id);
      }
    }
    const failures: string[] = [];
    for (const id of ids) {
      collectErasureFailure(
        await executor.forget({ id }, systemUser, ctx.db),
        entityName,
        id,
        failures,
      );
    }
    throwIfErasureFailed(failures);
  };
}
