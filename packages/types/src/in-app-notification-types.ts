// Contract between the channel-in-app feature (server) and the notification bell in the
// renderer shell. The renderer must not import bundled-features, so both sides share this file.

export const IN_APP_NOTIFICATION_FEATURE = "channel-in-app" as const;

export const IN_APP_NOTIFICATION_QUERIES = {
  inbox: "channel-in-app:query:inbox",
  unreadCount: "channel-in-app:query:unread-count",
} as const;

export const IN_APP_NOTIFICATION_WRITES = {
  markRead: "channel-in-app:write:mark-read",
  markAllRead: "channel-in-app:write:mark-all-read",
} as const;

export const IN_APP_NOTIFICATION_DELIVERED_EVENT = "channel-in-app:event:delivered" as const;

export type InAppNotificationTarget = {
  readonly screenId: string;
  readonly entityId?: string;
};

export type InAppInboxRow = {
  readonly id: number;
  readonly notificationType: string;
  readonly title: string;
  readonly body: string | null;
  readonly isRead: boolean;
  readonly createdAt: string;
  readonly target: InAppNotificationTarget | null;
};

export type InAppInboxResult = {
  readonly rows: readonly InAppInboxRow[];
  readonly nextCursor: string | null;
  readonly total: number;
};
