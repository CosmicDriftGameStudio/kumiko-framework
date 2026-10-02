import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  notificationPreferenceEntity,
  notificationPreferencesTable,
} from "../../delivery/index.js";
import { collectErasureFailure, throwIfErasureFailed } from "../../shared/index.js";
import { featureMounted } from "./feature-mounted.js";

// userData-Hooks for delivery's notification-preference rows. Event-sourced
// entity → forget goes through the executor so a rebuild replays the erasure.
// A preference without its user is meaningless, so both strategies purge via
// the forget verb.
//
// The delivery ATTEMPTS log is covered separately: export via
// delivery-attempt.userdata-hook.ts, erasure via crypto-shredding (#799).

const crud = createEventStoreExecutor(notificationPreferencesTable, notificationPreferenceEntity, {
  entityName: "notification-preference",
});

export const notificationPreferenceExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "delivery")) return null;
  const rows = await ctx.db.selectMany<Record<string, unknown>>(notificationPreferencesTable, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "notification-preference",
    rows: rows.map((r) => ({
      notificationType: r["notificationType"],
      channel: r["channel"],
      enabled: r["enabled"],
    })),
  };
};

export const notificationPreferenceDeleteHook: UserDataDeleteHook = async (ctx) => {
  // skip: delivery not mounted — its table doesn't exist, nothing to erase.
  if (!featureMounted(ctx, "delivery")) return;
  const systemUser = createSystemUser(ctx.tenantId);
  const rows = await ctx.db.selectMany<Record<string, unknown>>(notificationPreferencesTable, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  const failures: string[] = [];
  for (const row of rows) {
    const id = row["id"]; // @cast-boundary db-row
    if (typeof id !== "string") continue;
    collectErasureFailure(
      await crud.forget({ id }, systemUser, ctx.db),
      "notification-preference",
      id,
      failures,
    );
  }
  throwIfErasureFailed(failures);
};
