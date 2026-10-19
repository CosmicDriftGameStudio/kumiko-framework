import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { escapeHtml } from "@cosmicdrift/kumiko-renderer/headless";
import { createEmailChannel, type EmailChannelOptions } from "../../channel-email/email-channel.ts";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.ts";

// Delivery-mechanics tests (rate limit, idempotency, opt-out, PII) send ad-hoc
// notification types over email. The real channel fails those permanently, so
// this wrapper renders undeclared types as plain title/body and delegates
// everything else (declared templates, send, guards) to the real channel.
export function createPlainFallbackEmailFeature(options: EmailChannelOptions): FeatureDefinition {
  const channel = createEmailChannel(options);
  return defineFeature("channel-email", (r) => {
    r.requires({ features: ["delivery"] });
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, "email", {
      mode: channel.mode,
      resolve: channel.resolve,
      async render(message, ctx) {
        const declared = ctx.registry.getAllNotifications().get(message.notificationType);
        if (declared?.template !== undefined) {
          if (channel.render === undefined) throw new Error("email channel has no render");
          return channel.render(message, ctx);
        }
        const body = message.body ?? "";
        return {
          subject: message.title,
          html: `<h1>${escapeHtml(message.title)}</h1><p>${escapeHtml(body)}</p>`,
          text: `${message.title}\n\n${body}`,
        };
      },
      send: channel.send,
    });
  });
}
