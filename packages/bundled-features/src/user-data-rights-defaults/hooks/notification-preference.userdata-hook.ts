import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { notificationPreferenceEntity, notificationPreferencesTable } from "../../delivery";
import { featureMounted } from "./feature-mounted";

// userData-Hooks for delivery's notification-preference rows. Event-sourced
// entity → forget goes through the executor so a rebuild replays the erasure.
// A preference without its user is meaningless, so both strategies purge via
// the forget verb.
//
// The delivery ATTEMPTS log (read_delivery_attempts, recipientAddress) is NOT
// covered here: it is an events-only aggregate whose payload lives in the
// append-only event store — per-user redaction there needs the event-store
// redaction epic; a read-side UPDATE would be wiped on rebuild.

const crud = createEventStoreExecutor(notificationPreferencesTable, notificationPreferenceEntity, {
  entityName: "notification-preference",
});

export const notificationPreferenceExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "delivery")) return null;
  const rows = await selectMany<Record<string, unknown>>(ctx.db, notificationPreferencesTable, {
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
  const tdb = createTenantDb(ctx.db, ctx.tenantId, "system");
  const rows = await selectMany<Record<string, unknown>>(ctx.db, notificationPreferencesTable, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  for (const row of rows) {
    const id = row["id"]; // @cast-boundary db-row
    if (typeof id !== "string") continue;
    await crud.forget({ id }, systemUser, tdb);
  }
};
