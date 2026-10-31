import type { EventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { collectErasureFailure, throwIfErasureFailed } from "../../shared/index.ts";
import { featureMounted } from "./feature-mounted.ts";

type OwnRowsTable = Parameters<UserDataHookCtx["db"]["selectMany"]>[0];

// Event-sourced rows owned by the user: forgetting goes through the executor so a rebuild replays
// the erasure.
export function forgetOwnRowsDeleteHook(source: {
  readonly featureName: string;
  readonly entityName: string;
  readonly table: OwnRowsTable;
  readonly executor: Pick<EventStoreExecutor, "forget">;
}): UserDataDeleteHook {
  const { featureName, entityName, table, executor } = source;
  return async (ctx) => {
    // skip: source feature not mounted — its table doesn't exist, nothing to erase.
    if (!featureMounted(ctx, featureName)) return;
    const systemUser = createSystemUser(ctx.tenantId);
    const rows = await ctx.db.selectMany<Record<string, unknown>>(table, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    const failures: string[] = [];
    for (const row of rows) {
      const id = row["id"]; // @cast-boundary db-row
      if (typeof id !== "string") continue;
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
