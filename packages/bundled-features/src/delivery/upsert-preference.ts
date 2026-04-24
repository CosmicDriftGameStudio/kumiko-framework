// Race-safe upsert for notification-preferences. Pre-ES this was a single
// `onConflictDoUpdate` statement on the preferences table; post-ES we go
// through the event-store executor, which doesn't offer a built-in upsert.
// Splitting into lookup + create|update re-opens the race window for
// concurrent requests — typical case: a user clicks the same "unsubscribe"
// email link three times in a second.
//
// The fix: try the optimistic path (lookup + create|update), and on a
// unique-index-violation race from a parallel create, re-lookup and fall
// through to update. Worst case: one extra roundtrip for the loser of
// the race. Happy path: same number of queries as the pre-ES upsert.

import { createEventStoreExecutor, type DbRow, fetchOne, type TenantDb } from "@kumiko/framework/db";
import type { SessionUser, TenantId, WriteResult } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { notificationPreferenceEntity, notificationPreferencesTable } from "./tables";

const executor = createEventStoreExecutor(
  notificationPreferencesTable,
  notificationPreferenceEntity,
  { entityName: "notificationPreference" },
);

async function lookup(
  db: TenantDb,
  tenantId: TenantId,
  userId: string,
  notificationType: string,
  channel: string,
) {
  return fetchOne(
    db,
    notificationPreferencesTable,
    eq(notificationPreferencesTable.tenantId, tenantId),
    eq(notificationPreferencesTable.userId, userId),
    eq(notificationPreferencesTable.notificationType, notificationType),
    eq(notificationPreferencesTable.channel, channel),
  );
}

export type UpsertPreferenceInput = {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly notificationType: string;
  readonly channel: string;
  readonly enabled: boolean;
};

/**
 * Idempotent "set-this-preference-to-enabled-state" against the preferences
 * aggregate stream. Emits either `.created` (first time) or `.updated`
 * (subsequent) and catches the race-induced unique-index violation as a
 * fallback to update.
 */
export async function upsertPreference(
  db: TenantDb,
  actor: SessionUser,
  input: UpsertPreferenceInput,
): Promise<WriteResult<UpsertPreferenceInput>> {
  const existing = await lookup(
    db,
    input.tenantId,
    input.userId,
    input.notificationType,
    input.channel,
  );

  if (existing) {
    const row = existing as DbRow;
    const result = await executor.update(
      {
        id: row["id"] as string,
        version: row["version"] as number,
        changes: { enabled: input.enabled },
      },
      actor,
      db,
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: input };
  }

  try {
    const result = await executor.create(
      {
        userId: input.userId,
        notificationType: input.notificationType,
        channel: input.channel,
        enabled: input.enabled,
      },
      actor,
      db,
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: input };
  } catch (err) {
    // Race-fallback: a concurrent request beat us to the insert. The
    // unique-index on (tenant, user, type, channel) fires as a
    // postgres 23505 — catch broadly because drivers wrap it in varying
    // envelopes. Re-lookup; if we still miss, it's a genuine error worth
    // rethrowing.
    const afterRace = await lookup(
      db,
      input.tenantId,
      input.userId,
      input.notificationType,
      input.channel,
    );
    if (!afterRace) throw err;
    const row = afterRace as DbRow;
    const result = await executor.update(
      {
        id: row["id"] as string,
        version: row["version"] as number,
        changes: { enabled: input.enabled },
      },
      actor,
      db,
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: input };
  }
}
