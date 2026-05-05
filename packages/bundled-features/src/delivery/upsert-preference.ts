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

import { createEventStoreExecutor, fetchOne, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { notificationPreferenceEntity, notificationPreferencesTable } from "./tables";

const executor = createEventStoreExecutor(
  notificationPreferencesTable,
  notificationPreferenceEntity,
  { entityName: "notification-preference" },
);

// Konkretes Lookup-Result-Shape — nur die zwei Felder die der upsert
// tatsächlich für den Update-Path braucht. Vermeidet `row["x"] as T` index-
// access casts; der Generic-Param am fetchOne macht den Cast zentralisiert
// im Helper (db-row-boundary), nicht 4× pro Callsite.
type PreferenceLookupRow = { readonly id: string; readonly version: number };

async function lookup(
  db: TenantDb,
  tenantId: TenantId,
  userId: string,
  notificationType: string,
  channel: string,
): Promise<PreferenceLookupRow | undefined> {
  return fetchOne<PreferenceLookupRow>(
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
    // Race-fallback: another request beat us to the insert between our
    // lookup and the executor.create. The unique-index on
    // (tenant, user, type, channel) fires Postgres error 23505. Only that
    // specific error triggers the retry; DB-disconnect or any other
    // failure must bubble up unchanged so callers see the real cause.
    if (!isUniqueViolation(err)) throw err;
    const afterRace = await lookup(
      db,
      input.tenantId,
      input.userId,
      input.notificationType,
      input.channel,
    );
    if (!afterRace) throw err;
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
}

// Narrow detection for Postgres "duplicate key violates unique constraint"
// (SQLSTATE 23505). Drivers wrap the DB error in varying envelopes; we
// check the `code` field plus a string-match fallback so the match survives
// minor driver-version shifts without drifting wide.
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown }; message?: unknown };
  if (e.code === "23505") return true;
  if (e.cause && typeof e.cause === "object" && e.cause.code === "23505") return true;
  if (typeof e.message === "string" && e.message.includes("23505")) return true;
  return false;
}
