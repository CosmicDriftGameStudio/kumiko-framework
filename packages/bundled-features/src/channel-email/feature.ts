import {
  DELIVERY_CHANNEL_EXTENSION,
  EMAIL_CHANNEL_NAME,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createEmailChannel, type EmailChannelOptions } from "./email-channel.js";

export function createChannelEmailFeature(options: EmailChannelOptions): FeatureDefinition {
  const channel = createEmailChannel(options);

  return defineFeature("channel-email", (r) => {
    r.describe(
      "Wires an `EmailTransport` (typically `mail-transport-smtp` in production, `createInMemoryTransport()` in tests) into the delivery system as the `email` channel. Requires `delivery`; pass an `EmailChannelOptions` with a `transport` and a `resolveEmail` function that maps a user ID to their email address. Mails render from stored templates (`renderer-mail-html`): a notification routed to this channel needs `template` + `meta` on `r.notification`, otherwise its delivery fails. Pass `tenantTransport: tenantMailTransport` (from `mail-foundation`) to send the notifications declared with `tenantTransport: true` through the sending tenant's own configured provider: a broken provider fails the send, a tenant without one uses the app `transport`; every other notification (password reset, sign-in) always goes through the app `transport`. `transport` may be left out when `tenantTransport` is set; a mail that then has no transport fails with `missing_credentials`. Notifications declared with `unsubscribe: true` get a signed `data.unsubscribeUrl` from delivery, which turns into the `List-Unsubscribe` headers.",
    );
    r.uiHints({
      displayLabel: "Email Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires({ features: ["delivery"] });

    r.translations({ keys: { "delivery.channel.email": { en: "Email" } } });
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, EMAIL_CHANNEL_NAME, {
      mode: channel.mode,
      resolve: channel.resolve,
      render: channel.render,
      send: channel.send,
    });
  });
}
