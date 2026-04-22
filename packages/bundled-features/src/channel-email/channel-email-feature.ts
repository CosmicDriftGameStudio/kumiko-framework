import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { createEmailChannel, type EmailChannelOptions } from "./email-channel";

export function createChannelEmailFeature(options: EmailChannelOptions): FeatureDefinition {
  const channel = createEmailChannel(options);

  return defineFeature("channelEmail", (r) => {
    r.requires("delivery");

    r.useExtension("deliveryChannel", "email", {
      resolve: channel.resolve,
      send: channel.send,
    });
  });
}
