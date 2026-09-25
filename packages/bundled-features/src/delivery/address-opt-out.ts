import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { computeBlindIndex, configuredBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { generateDeterministicId } from "@cosmicdrift/kumiko-framework/utils";
import { notificationAddressOptOutEntity, notificationAddressOptOutsTable } from "./tables";

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

// One row per (tenant, addressHash, type, channel): mirrors
// preferenceAggregateId in upsert-preference.ts — concurrent first-time
// opt-outs collide on the same stream at append, not on the projection's
// unique index.
function addressOptOutAggregateId(
  tenantId: TenantId,
  addressHash: string,
  notificationType: string,
  channel: string,
): string {
  return generateDeterministicId(
    "delivery:notification-address-opt-out",
    `${tenantId}|${addressHash}|${notificationType}|${channel}`,
  );
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

  const id = addressOptOutAggregateId(
    input.tenantId,
    input.addressHash,
    input.notificationType,
    input.channel,
  );
  const created = await executor.create(
    {
      id,
      addressHash: input.addressHash,
      notificationType: input.notificationType,
      channel: input.channel,
    },
    actor,
    db,
  );
  if (created.isSuccess) return { isSuccess: true, data: input };
  // Race-fallback: another request's create already won this deterministic
  // id between our lookup and this create — the existing row already IS the
  // opt-out, so the race loser just reports success too.
  if (created.error.code !== "version_conflict") return created;
  // A conflict without a row means the stream exists but its row is gone —
  // report that instead of a silent "unsubscribed" that never persisted.
  const afterRace = await lookup(
    db,
    input.tenantId,
    input.addressHash,
    input.notificationType,
    input.channel,
  );
  if (!afterRace) return created;
  return { isSuccess: true, data: input };
}
