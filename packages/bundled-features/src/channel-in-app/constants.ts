export const CHANNEL_IN_APP_FEATURE = "channelInApp" as const;

export const InAppHandlers = {
  markRead: "channel-in-app:write:mark-read",
  markAllRead: "channel-in-app:write:mark-all-read",
} as const;

export const InAppQueries = {
  inbox: "channel-in-app:query:inbox",
  unreadCount: "channel-in-app:query:unread-count",
} as const;
