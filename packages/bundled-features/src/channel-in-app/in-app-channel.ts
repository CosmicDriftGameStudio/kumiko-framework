import { tenantChannel } from "@cosmicdrift/kumiko-framework/engine";
import type { DeliveryChannel } from "../delivery";
import { inAppMessagesTable } from "./tables";

export const inAppChannel: DeliveryChannel = {
  name: "inApp",

  async resolve(userId) {
    // InApp always resolves — the userId IS the address
    return String(userId);
  },

  async send(address, message, ctx) {
    // address is the user-id string after the ES migration — keep it as-is.
    const userId = address;

    const row = await insertOne<{ id: string }>(ctx.db, inAppMessagesTable, {
      tenantId: ctx.tenantId,
      userId,
      notificationType: message.notificationType,
      title: message.title,
      body: message.body ?? null,
      data: message.data ? JSON.stringify(message.data) : null,
    });

    if (ctx.sseBroker) {
      ctx.sseBroker.pushToChannel(tenantChannel(ctx.tenantId), {
        type: "channel-in-app:event:delivered",
        data: {
          id: row?.id,
          userId,
          notificationType: message.notificationType,
          title: message.title,
          body: message.body,
        },
      });
    }

    return { status: "sent", address };
  },
};
