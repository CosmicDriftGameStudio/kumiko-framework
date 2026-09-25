// Race-safe upsert for notification-preferences. Pre-ES this was a single
// `onConflictDoUpdate` statement on the preferences table; post-ES we go
// through the event-store executor, which doesn't offer a built-in upsert.
// Splitting into lookup + create|update re-opens the race window for
// concurrent requests — typical case: a user clicks the same "unsubscribe"
// email link three times in a second.
//
// The fix: the aggregate id is deterministic (tenant+user+type+channel), so
// concurrent first-time clicks collide at the event-store append itself
// (expectedVersion 0, confined to a savepoint) instead of racing past two
// independent creates and leaving an orphaned `created` event behind. The
// loser's create() comes back as a `version_conflict` failure; re-lookup and
// fall through to update, or no-op if the winner already set the target
// `enabled` state.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { generateDeterministicId } from "@cosmicdrift/kumiko-framework/utils";
import { notificationPreferenceEntity, notificationPreferencesTable } from "./tables";

const executor = createEventStoreExecutor(
  notificationPreferencesTable,
  notificationPreferenceEntity,
  { entityName: "notification-preference" },
);

// Konkretes Lookup-Result-Shape — nur die Felder die der upsert
// tatsächlich für den Update-Path braucht. Vermeidet `row["x"] as T` index-
// access casts; der Generic-Param am fetchOne macht den Cast zentralisiert
// im Helper (db-row-boundary), nicht 4× pro Callsite.
type PreferenceLookupRow = {
  readonly id: string;
  readonly version: number;
  readonly enabled: boolean;
};

// @wrapper-known semantic-alias
async function lookup(
  db: TenantDb,
  tenantId: TenantId,
  userId: string,
  notificationType: string,
  channel: string,
): Promise<PreferenceLookupRow | undefined> {
  return fetchOne<PreferenceLookupRow>(db, notificationPreferencesTable, {
    tenantId,
    userId,
    notificationType,
    channel,
  });
}

export type UpsertPreferenceInput = {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly notificationType: string;
  readonly channel: string;
  readonly enabled: boolean;
};

// One row per (tenant, user, type, channel): folding the tuple into the
// aggregate id means two concurrent first-time clicks collide on the same
// stream at append instead of racing two independent creates.
function preferenceAggregateId(
  tenantId: TenantId,
  userId: string,
  notificationType: string,
  channel: string,
): string {
  return generateDeterministicId(
    "delivery:notification-preference",
    `${tenantId}|${userId}|${notificationType}|${channel}`,
  );
}

/**
 * Idempotent "set-this-preference-to-enabled-state" against the preferences
 * aggregate stream. Emits either `.created` (first time) or `.updated`
 * (subsequent) and converges a concurrent create-race onto the winner's row.
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
    if (existing.enabled === input.enabled) return { isSuccess: true, data: input };
    const result = await executor.update(
      {
        id: existing.id,
        version: existing.version,
        changes: { enabled: input.enabled },
      },
      actor,
      db,
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: input };
  }

  const id = preferenceAggregateId(
    input.tenantId,
    input.userId,
    input.notificationType,
    input.channel,
  );
  const created = await executor.create(
    {
      id,
      userId: input.userId,
      notificationType: input.notificationType,
      channel: input.channel,
      enabled: input.enabled,
    },
    actor,
    db,
  );
  if (created.isSuccess) return { isSuccess: true, data: input };
  if (created.error.code !== "version_conflict") return created;

  // Race-fallback: another request's create already won this deterministic
  // id between our lookup and this create. Re-lookup and converge onto its
  // row — no-op if it already set the target `enabled`, since relooking the
  // same version and updating would version_conflict all but one loser.
  const afterRace = await lookup(
    db,
    input.tenantId,
    input.userId,
    input.notificationType,
    input.channel,
  );
  if (!afterRace) return created;
  if (afterRace.enabled === input.enabled) return { isSuccess: true, data: input };
  const result = await executor.update(
    {
      id: afterRace.id,
      version: afterRace.version,
      changes: { enabled: input.enabled },
    },
    actor,
    db,
  );
  if (!result.isSuccess) return result;
  return { isSuccess: true, data: input };
}
