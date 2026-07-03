import { deleteMany, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { inAppMessagesTable } from "../../channel-in-app";
import { featureMounted } from "./feature-mounted";

// userData-Hooks for channel-in-app's in_app_messages. Plain SQL table (no
// r.entity, no event stream — see channel-in-app/tables.ts), written by
// direct INSERT in the channel adapter, so a direct DELETE is rebuild-safe.
// Messages are addressed TO the user (title/body can quote personal content);
// both strategies hard-delete.
//
// This table has no entity fields, so the V3 pii-annotation boot guard cannot
// see it — coverage lives solely in these hooks.

export const inAppMessageExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "channel-in-app")) return null;
  const rows = await selectMany<Record<string, unknown>>(ctx.db, inAppMessagesTable, {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "in-app-message",
    rows: rows.map((r) => ({
      notificationType: r["notificationType"] ?? null,
      title: r["title"] ?? null,
      body: r["body"] ?? null,
      isRead: r["isRead"] ?? false,
      createdAt: String(r["createdAt"] ?? ""),
    })),
  };
};

export const inAppMessageDeleteHook: UserDataDeleteHook = async (ctx) => {
  if (!featureMounted(ctx, "channel-in-app")) return;
  await deleteMany(ctx.db, inAppMessagesTable, { userId: ctx.userId, tenantId: ctx.tenantId });
};
