import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { inboxQuery } from "./handlers/inbox.query";
import { markAllReadWrite } from "./handlers/mark-all-read.write";
import { markReadWrite } from "./handlers/mark-read.write";
import { unreadCountQuery } from "./handlers/unread-count.query";
import { inAppChannel } from "./in-app-channel";

export function createChannelInAppFeature(): FeatureDefinition {
  return defineFeature("channel-in-app", (r) => {
    r.describe(
      "Persists notifications to an in-app inbox table so users can retrieve them via `handlers.inbox` and track unread state with `handlers.markRead` / `handlers.markAllRead` and `queries.unreadCount`. Requires `delivery`; no external service needed \u2014 messages are stored in the app's own database.",
    );
    r.uiHints({
      displayLabel: "In-App Inbox",
      category: "notifications",
      recommended: false,
    });
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
