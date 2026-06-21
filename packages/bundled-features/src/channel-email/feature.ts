import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createEmailChannel, type EmailChannelOptions } from "./email-channel";

export function createChannelEmailFeature(options: EmailChannelOptions): FeatureDefinition {
  const channel = createEmailChannel(options);

  return defineFeature("channel-email", (r) => {
    r.describe(
      "Wires an `EmailTransport` (typically `mail-transport-smtp` in production, `createInMemoryTransport()` in tests) into the delivery system as the `email` channel. Requires `delivery`; pass an `EmailChannelOptions` with a `transport`, a `renderer: NotificationRenderer` (e.g. backed by `renderer-simple`), and a `resolveEmail` function that maps a user ID to their email address.",
    );
    r.uiHints({
      displayLabel: "Email Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires("delivery");

    r.useExtension("deliveryChannel", "email", {
      resolve: channel.resolve,
      send: channel.send,
    });
  });
}
