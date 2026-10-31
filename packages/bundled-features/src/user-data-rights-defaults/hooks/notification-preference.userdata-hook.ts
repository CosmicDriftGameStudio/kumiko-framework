import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import {
  notificationPreferenceEntity,
  notificationPreferencesTable,
} from "../../delivery/index.ts";
import { featureMounted } from "./feature-mounted.ts";
import { forgetOwnRowsDeleteHook } from "./forget-own-rows-delete-hook.ts";

// userData-Hooks for delivery's notification-preference rows. Event-sourced
// entity → forget goes through the executor so a rebuild replays the erasure.
// A preference without its user is meaningless, so both strategies purge via
// the forget verb.
//
// The delivery ATTEMPTS log is covered separately: export via
// delivery-attempt.userdata-hook.ts, erasure via crypto-shredding.

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

export const notificationPreferenceDeleteHook: UserDataDeleteHook = forgetOwnRowsDeleteHook({
  featureName: "delivery",
  entityName: "notification-preference",
  table: notificationPreferencesTable,
  executor: crud,
});
