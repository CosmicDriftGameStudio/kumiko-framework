import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { collectErasureFailure, throwIfErasureFailed } from "../../shared/index.js";
import { downloadAttemptEntity, downloadAttemptsTable } from "../../user-data-rights/index.js";

// Event-sourced entity: forget goes through the executor so the erasure replays
// on rebuild and removes the projection row including ip_bidx.
const crud = createEventStoreExecutor(downloadAttemptsTable, downloadAttemptEntity, {
  entityName: "download-attempt",
});

// Only job-path attempts name a user; token-path rows have no owner and sit
// under the tenant key. ip may be ciphertext (kumiko-pii:), which the export
// runner's central decrypt sweep resolves.
export const downloadAttemptExportHook: UserDataExportHook = async (ctx) => {
  const rows = await ctx.db.selectMany<Record<string, unknown>>(downloadAttemptsTable, {
    tenantId: ctx.tenantId,
    attemptedByUserId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "download-attempt",
    rows: rows.map((r) => ({
      result: r["result"],
      via: r["via"],
      ip: r["ip"],
      userAgent: r["userAgent"],
      attemptedAt: r["attemptedAt"],
    })),
  };
};

// Both strategies purge: key erasure alone leaves attemptedByUserId and the
// blind index linking the user to the row until retention, and not every forget
// path shreds the subject key.
export const downloadAttemptDeleteHook: UserDataDeleteHook = async (ctx) => {
  const systemUser = createSystemUser(ctx.tenantId);
  const rows = await ctx.db.selectMany<Record<string, unknown>>(downloadAttemptsTable, {
    tenantId: ctx.tenantId,
    attemptedByUserId: ctx.userId,
  });
  const failures: string[] = [];
  for (const row of rows) {
    const id = row["id"];
    if (typeof id !== "string") continue;
    collectErasureFailure(
      await crud.forget({ id }, systemUser, ctx.db),
      "download-attempt",
      id,
      failures,
    );
  }
  throwIfErasureFailed(failures);
};
