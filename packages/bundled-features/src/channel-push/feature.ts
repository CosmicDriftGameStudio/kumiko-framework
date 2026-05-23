import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createPushChannel, type PushChannelOptions } from "./push-channel";

export function createChannelPushFeature(options: PushChannelOptions): FeatureDefinition {
  const channel = createPushChannel(options);

  return defineFeature("channel-push", (r) => {
    r.requires("delivery");

    r.useExtension("deliveryChannel", "push", {
      resolve: channel.resolve,
      send: channel.send,
    });
  });
}
