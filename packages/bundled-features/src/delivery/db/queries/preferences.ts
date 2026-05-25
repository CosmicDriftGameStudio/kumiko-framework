import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type NotificationPreferenceRow = {
  readonly notificationType: string;
  readonly channel: string;
  readonly enabled: boolean;
};

export async function selectNotificationPreferences(
  db: DbConnection,
  tenantId: TenantId,
  userId: string,
  notificationType: string,
  channelName: string,
): Promise<readonly NotificationPreferenceRow[]> {
  return asRawClient(db).unsafe<NotificationPreferenceRow>(
    `SELECT notification_type AS "notificationType", channel, enabled
     FROM read_notification_preferences
     WHERE tenant_id = $1
       AND user_id = $2
       AND (
         (notification_type = $3 AND channel = $4)
         OR (notification_type = '*' AND channel = $4)
         OR (notification_type = $3 AND channel = '*')
       )`,
    [tenantId, userId, notificationType, channelName],
  );
}
