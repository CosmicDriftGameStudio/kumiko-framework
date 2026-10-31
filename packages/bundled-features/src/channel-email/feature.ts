import {
  DELIVERY_CHANNEL_EXTENSION,
  EMAIL_CHANNEL_NAME,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { EMAIL_APP_TRANSPORT_EXTENSION, EMAIL_APP_TRANSPORT_USAGE } from "./app-transport.ts";
import { createEmailChannel, type EmailChannelOptions } from "./email-channel.ts";
import { smtpEnvSchema } from "./env.ts";

export function createChannelEmailFeature(options: EmailChannelOptions) {
  const channel = createEmailChannel(options);
  const appTransport = options.transport ?? null;

  const feature = defineFeature("channel-email", (r) => {
    r.describe(
      "Wires an `EmailTransport` (typically `mail-transport-smtp` in production, `createInMemoryTransport()` in tests) into the delivery system as the `email` channel. Requires `delivery`; pass an `EmailChannelOptions` with a `transport` and a `resolveEmail` function that maps a user ID to their email address. Mails render from stored templates (`renderer-mail-html`): a notification routed to this channel needs `template` + `meta` on `r.notification`, otherwise its delivery fails. Pass `tenantTransport: tenantMailTransport` (from `mail-foundation`) to send the notifications declared with `tenantTransport: true` through the sending tenant's own configured provider: a broken provider fails the send, a tenant without one uses the app `transport`; every other notification (password reset, sign-in) always goes through the app `transport`. `transport` may be left out when `tenantTransport` is set, but then only notifications declared with `tenantTransport: true` are delivered: every other notification (password reset, sign-in, invitations) fails with `missing_credentials`, so an app without an app SMTP server must mark every notification that should go out or keep an app `transport`. Notifications declared with `unsubscribe: true` get a signed `data.unsubscribeUrl` from delivery, which turns into the `List-Unsubscribe` headers.",
    );
    r.uiHints({
      displayLabel: "Email Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires({ features: ["delivery"] });
    r.envSchema(smtpEnvSchema);

    r.translations({ keys: { "delivery.channel.email": { en: "Email" } } });
    r.extendsRegistrar(EMAIL_APP_TRANSPORT_EXTENSION, {});
    r.useExtension(EMAIL_APP_TRANSPORT_EXTENSION, EMAIL_APP_TRANSPORT_USAGE, {
      transport: appTransport,
    });
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, EMAIL_CHANNEL_NAME, {
      mode: channel.mode,
      resolve: channel.resolve,
      render: channel.render,
      send: channel.send,
    });
  });
  return featureWithEnvSchema(feature, smtpEnvSchema);
}
