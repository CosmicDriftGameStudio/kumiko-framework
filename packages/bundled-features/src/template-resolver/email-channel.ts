import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { collectChannels, EMAIL_CHANNEL_NAME } from "../delivery/index.ts";

export function emailChannelOf(registry: Registry) {
  return collectChannels(registry).find((channel) => channel.name === EMAIL_CHANNEL_NAME);
}
