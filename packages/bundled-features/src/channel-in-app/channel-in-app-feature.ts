import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { inboxQuery } from "./handlers/inbox.query";
import { markAllReadWrite } from "./handlers/mark-all-read.write";
import { markReadWrite } from "./handlers/mark-read.write";
import { unreadCountQuery } from "./handlers/unread-count.query";
import { inAppChannel } from "./in-app-channel";

export function createChannelInAppFeature(): FeatureDefinition {
  return defineFeature("channelInApp", (r) => {
    r.requires("delivery");

    // Register as delivery channel via extension system
    r.useExtension("deliveryChannel", "inApp", {
      resolve: inAppChannel.resolve,
      send: inAppChannel.send,
    });

    const handlers = {
      markRead: r.writeHandler(markReadWrite),
      markAllRead: r.writeHandler(markAllReadWrite),
    };

    const queries = {
      inbox: r.queryHandler(inboxQuery),
      unreadCount: r.queryHandler(unreadCountQuery),
    };

    return { handlers, queries };
  });
}
