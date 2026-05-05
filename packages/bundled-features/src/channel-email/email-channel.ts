import type { DbRow } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { DeliveryChannel, NotificationRenderer } from "../delivery";
import type { EmailTransport } from "./types";

export type EmailChannelOptions = {
  readonly transport: EmailTransport;
  readonly renderer: NotificationRenderer;
  readonly resolveEmail: (
    userId: string,
    ctx: { db: unknown; tenantId: TenantId },
  ) => Promise<string | null>;
};

export function createEmailChannel(options: EmailChannelOptions): DeliveryChannel {
  const { transport, renderer, resolveEmail } = options;

  return {
    name: "email",

    async resolve(userId, ctx) {
      return resolveEmail(userId, ctx);
    },

    async send(address, message, _ctx) {
      // Build renderer input: per-channel template data (if any) or fall back
      // to title/body from the message. Renderer handles both cases.
      const variables = (message.data as DbRow) ?? {
        title: message.title,
        body: message.body,
      };

      const html = await renderer.render({
        template: message.notificationType,
        variables,
      });
      const subject = (variables["subject"] as string) ?? message.title;

      await transport.send({
        to: address,
        subject,
        html,
      });

      return { status: "sent", address };
    },
  };
}
