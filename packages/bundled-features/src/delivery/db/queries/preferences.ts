import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type NotificationPreferenceRow = {
  readonly notificationType: string;
  readonly channel: string;
  readonly enabled: boolean;
};

// @wrapper-known semantic-alias
export async function selectNotificationPreferences(
  db: DbConnection,
  tenantId: TenantId,
  userId: string,
  notificationTypeNames: readonly string[],
  channelName: string,
): Promise<readonly NotificationPreferenceRow[]> {
  return unsafeReadRetrying<NotificationPreferenceRow>(
    db,
    `SELECT notification_type AS "notificationType", channel, enabled
     FROM read_notification_preferences
     WHERE tenant_id = $1
       AND user_id = $2
       AND (
         (notification_type = ANY($3::text[]) AND channel = $4)
         OR (notification_type = '*' AND channel = $4)
         OR (notification_type = ANY($3::text[]) AND channel = '*')
       )`,
    [tenantId, userId, notificationTypeNames, channelName],
  );
}
