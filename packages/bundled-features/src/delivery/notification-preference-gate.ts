import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  type NotificationPreferenceRow,
  selectNotificationPreferencesForUsers,
} from "./db/queries/preferences.ts";

export type PreferencesByUser = ReadonlyMap<string, readonly NotificationPreferenceRow[]>;

export async function loadPreferencesByUser(
  db: DbConnection,
  tenantId: TenantId,
  userIds: readonly string[],
  notificationTypeNames: readonly string[],
): Promise<PreferencesByUser> {
  const rows = await selectNotificationPreferencesForUsers(
    db,
    tenantId,
    userIds,
    notificationTypeNames,
  );
  const byUser = new Map<string, NotificationPreferenceRow[]>();
  for (const row of rows) {
    const userRows = byUser.get(row.userId);
    if (userRows) userRows.push(row);
    else byUser.set(row.userId, [row]);
  }
  return byUser;
}

// Check if user has disabled this notification+channel combo.
// Specificity order: exact > any wildcard. When only wildcards match and they
// disagree, "disabled wins" — the user has asked to be opted out somewhere,
// and an exact override is the way to punch through it. Without this rule
// the outcome would depend on row insertion order in the DB.
// Example:
//   { type: "*", channel: "inApp", enabled: false }         disables inApp globally
//   { type: "orderAssigned", channel: "*", enabled: true }  enables orderAssigned everywhere
//   → orderAssigned on inApp: disabled (conservative) unless an exact entry overrides.
export function isChannelEnabledByPreferences(
  rows: readonly NotificationPreferenceRow[],
  notificationTypeNames: readonly string[],
  notificationType: string,
  channelName: string,
): boolean {
  // A ('*','*') row never matches: only a wildcard on one axis counts, so a global row cannot
  // silence everything.
  const prefs = rows.filter(
    (p) =>
      (p.channel === channelName &&
        (p.notificationType === "*" || notificationTypeNames.includes(p.notificationType))) ||
      (p.channel === "*" && notificationTypeNames.includes(p.notificationType)),
  );

  if (prefs.length === 0) return true;

  // Exact match (both specific) wins over any wildcard
  const exact = prefs.find(
    (p) => p.notificationType === notificationType && p.channel === channelName,
  );
  if (exact) return exact.enabled;

  // Rows stored under a former name: the user's choice from before the rename
  const aliasExact = prefs.filter(
    (p) =>
      p.notificationType !== "*" &&
      p.notificationType !== notificationType &&
      p.channel === channelName,
  );
  if (aliasExact.length > 0) return !aliasExact.some((p) => p.enabled === false);

  // Only wildcards matched: any disabled entry disables delivery (deterministic
  // and conservative — DB ordering no longer decides the outcome).
  return !prefs.some((p) => p.enabled === false);
}
