import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { computeBlindIndex, configuredBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { notificationAddressOptOutEntity, notificationAddressOptOutsTable } from "./tables";
import { isUniqueViolation } from "./upsert-preference";

const executor = createEventStoreExecutor(
  notificationAddressOptOutsTable,
  notificationAddressOptOutEntity,
  { entityName: "notification-address-opt-out" },
);

// Keyed hash of a recipient address that never had a user account — the
// plaintext address must never reach the opt-out row or the unsubscribe token.
// Undefined when no blind-index key is configured: there is nothing to
// compare against, so callers must treat that as "can't tell".
export function hashUnsubscribeAddress(address: string): string | undefined {
  const key = configuredBlindIndexKey();
  if (key === undefined) return undefined;
  return computeBlindIndex(key, address.trim().toLowerCase());
}

export type UpsertAddressOptOutInput = {
  readonly tenantId: TenantId;
  readonly addressHash: string;
  readonly notificationType: string;
  readonly channel: string;
};

type OptOutLookupRow = { readonly id: string };

async function lookup(
  db: TenantDb,
  tenantId: TenantId,
  addressHash: string,
  notificationType: string,
  channel: string,
): Promise<OptOutLookupRow | undefined> {
  return fetchOne<OptOutLookupRow>(db, notificationAddressOptOutsTable, {
    tenantId,
    addressHash,
    notificationType,
    channel,
  });
}

/**
 * Create-or-noop: opting the same address out twice must not produce a
 * second row or fail the second click. There is no update path — unlike
 * user preferences an address opt-out has no `enabled` flag to flip back.
 */
export async function upsertAddressOptOut(
  db: TenantDb,
  actor: SessionUser,
  input: UpsertAddressOptOutInput,
): Promise<WriteResult<UpsertAddressOptOutInput>> {
  const existing = await lookup(
    db,
    input.tenantId,
    input.addressHash,
    input.notificationType,
    input.channel,
  );
  if (existing) return { isSuccess: true, data: input };

  try {
    const result = await executor.create(
      {
        addressHash: input.addressHash,
        notificationType: input.notificationType,
        channel: input.channel,
      },
      actor,
      db,
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: input };
  } catch (err) {
    // Race-fallback mirrors upsertPreference: another request created the
    // row between our lookup and executor.create. Nothing to update to —
    // the existing row already IS the opt-out, so the race loser just
    // reports success too.
    if (!isUniqueViolation(err)) throw err;
    return { isSuccess: true, data: input };
  }
}
