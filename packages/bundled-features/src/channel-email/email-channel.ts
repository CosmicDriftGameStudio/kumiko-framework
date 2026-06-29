import type { DbRow } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type {
  ChannelMessage,
  DeliveryChannel,
  NotificationRenderer,
  RenderedMessage,
} from "../delivery";
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

  // Render is the expensive step (template engine, possibly a remote service)
  // and runs in the delivery.render job, decoupled from the SMTP send so each
  // can retry independently. Extracted so the inline fallback (no job runner)
  // can reuse it without going through the channel's own render() indirection.
  async function renderMessage(message: ChannelMessage): Promise<RenderedMessage> {
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
    const subject = (variables["subject"] as string) ?? message.title; // @cast-boundary dynamic-key
    return { html, subject };
  }

  return {
    name: "email",
    mode: "queued",

    async resolve(userId, ctx) {
      return resolveEmail(userId, ctx);
    },

    render(message, _ctx) {
      return renderMessage(message);
    },

    async send(address, message, _ctx, rendered) {
      const { html, subject } = rendered ?? (await renderMessage(message));
      await transport.send({ to: address, subject, html });
      return { status: "sent", address };
    },
  };
}
