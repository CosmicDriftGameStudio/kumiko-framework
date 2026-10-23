import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { deleteRowsViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import { notificationPreferenceEntity, notificationPreferencesTable } from "../tables.ts";

export function deletePreferencesOfUser(db: DbConnection, user: SessionUser): Promise<void> {
  return deleteRowsViaEventStore(
    db,
    {
      table: notificationPreferencesTable,
      entity: notificationPreferenceEntity,
      entityName: "notification-preference",
    },
    { userId: user.id },
    { tenantId: user.tenantId },
  );
}
