import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { toPostgresArrayLiteral, unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type NotificationPreferenceRow = {
  readonly userId: string;
  readonly notificationType: string;
  readonly channel: string;
  readonly enabled: boolean;
};

export async function selectNotificationPreferencesForUsers(
  db: DbConnection,
  tenantId: TenantId,
  userIds: readonly string[],
  notificationTypeNames: readonly string[],
): Promise<readonly NotificationPreferenceRow[]> {
  if (userIds.length === 0) return [];
  return unsafeReadRetrying<NotificationPreferenceRow>(
    db,
    `SELECT user_id AS "userId", notification_type AS "notificationType", channel, enabled
     FROM read_notification_preferences
     WHERE tenant_id = $1
       AND user_id = ANY($2::text[])
       AND (notification_type = ANY($3::text[]) OR notification_type = '*')`,
    [tenantId, toPostgresArrayLiteral(userIds), toPostgresArrayLiteral(notificationTypeNames)],
  );
}
