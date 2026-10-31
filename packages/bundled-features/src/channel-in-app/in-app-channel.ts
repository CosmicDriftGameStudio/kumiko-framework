import { tenantChannel } from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { IN_APP_NOTIFICATION_DELIVERED_EVENT } from "@cosmicdrift/kumiko-types/in-app-notification-types";
import type { DeliveryChannel } from "../delivery/index.ts";
import { targetOfNotificationData } from "./in-app-target.ts";
import { inAppMessagesTable } from "./tables.ts";

const log = createFallbackLogger("channel-in-app");

export const inAppChannel: DeliveryChannel = {
  name: "inApp",
  mode: "inline",

  async resolve(userId) {
    // InApp always resolves — the userId IS the address
    return String(userId);
  },

  async send(address, message, ctx) {
    // address is the user-id string after the ES migration — keep it as-is.
    const userId = address;

    // A malformed target drops only the link, never the notification.
    const target = targetOfNotificationData(message.data);
    const storedData =
      message.data === undefined
        ? null
        : JSON.stringify({ ...message.data, target: target ?? undefined });

    const row = await ctx.db.insertOne<{ id: string }>(inAppMessagesTable, {
      userId,
      notificationType: message.notificationType,
      title: message.title,
      body: message.body ?? null,
      data: storedData,
      idempotencyKey: ctx.idempotencyKey ?? null,
    });

    if (ctx.sseBroker) {
      // The row is stored, so a failing push (e.g. Redis down) must not turn the delivery into
      // a failure that gets retried and stored twice. Clients fetch the inbox on reconnect.
      try {
        await ctx.sseBroker.pushToChannel(tenantChannel(ctx.tenantId), {
          type: IN_APP_NOTIFICATION_DELIVERED_EVENT,
          data: { id: row?.id, userId, notificationType: message.notificationType },
        });
      } catch (error) {
        log.warn("in-app SSE push failed; the notification is stored", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { status: "sent", address };
  },
};
