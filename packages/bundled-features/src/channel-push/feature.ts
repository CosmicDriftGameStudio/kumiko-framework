import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createPushChannel, type PushChannelOptions } from "./push-channel";

export function createChannelPushFeature(options: PushChannelOptions): FeatureDefinition {
  const channel = createPushChannel(options);

  return defineFeature("channel-push", (r) => {
    r.describe(
      "Delivers push notifications through a `PushTransport` (bring your own FCM/APNs adapter or use `createInMemoryPushTransport()` for tests) registered as the `push` channel in the delivery system. Requires `delivery`; supply a `PushChannelOptions` with a transport and a resolver that maps a user ID to their device token.",
    );
    r.uiHints({
      displayLabel: "Push Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires("delivery");

    r.useExtension("deliveryChannel", "push", {
      mode: channel.mode,
      resolve: channel.resolve,
      send: channel.send,
    });
  });
}
