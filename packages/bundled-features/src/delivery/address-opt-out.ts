import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { computeBlindIndex, configuredBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateDeterministicId } from "@cosmicdrift/kumiko-framework/utils";
import { DeliveryErrors } from "./public-names";
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
//
// `generation` picks a distinct deterministic id for the same business key —
// needed because removeAddressOptOut() hard-deletes the row (no softDelete on
// this entity, see tables.ts), which leaves generation 0's stream in a
// deleted state forever (event-store streams are immutable once deleted).
// A later opt-out for the same address/type/channel must land on a fresh
// stream instead of colliding with the dead one. Generation 0 keeps the
// unsuffixed id for backwards-compatibility with rows written before
// resubscribe existed.
function addressOptOutAggregateId(
  tenantId: TenantId,
  addressHash: string,
  notificationType: string,
  channel: string,
  generation: number,
): string {
  const base = `${tenantId}|${addressHash}|${notificationType}|${channel}`;
  return generateDeterministicId(
    "delivery:notification-address-opt-out",
    generation === 0 ? base : `${base}|g${generation}`,
  );
}

// Hard-cap on generation retries — a version_conflict with no row means the
// stream at that generation was deleted by a previous resubscribe; this
// bounds the opt-out/resubscribe ping-pong instead of looping forever on a
// pathological retry storm.
const MAX_ADDRESS_OPT_OUT_GENERATIONS = 100;

// Test-only: lets integration tests seed a row at an arbitrary generation
// (e.g. the last one, to exercise removeAddressOptOut's limit) via the same
// executor.create seed pattern production code uses, instead of looping
// upsertAddressOptOut 100 times or writing the table directly.
export function addressOptOutAggregateIdForTests(
  tenantId: TenantId,
  addressHash: string,
  notificationType: string,
  channel: string,
  generation: number,
): string {
  return addressOptOutAggregateId(tenantId, addressHash, notificationType, channel, generation);
}

export const MAX_ADDRESS_OPT_OUT_GENERATIONS_FOR_TESTS = MAX_ADDRESS_OPT_OUT_GENERATIONS;

/**
 * Create-or-noop: opting the same address out twice must not produce a
 * second row or fail the second click. Resubscribing (removeAddressOptOut)
 * hard-deletes the row, so a later opt-out probes forward through
 * generations until it finds one whose stream isn't already dead.
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

  let lastFailure: WriteResult<UpsertAddressOptOutInput> | undefined;
  for (let generation = 0; generation < MAX_ADDRESS_OPT_OUT_GENERATIONS; generation++) {
    const id = addressOptOutAggregateId(
      input.tenantId,
      input.addressHash,
      input.notificationType,
      input.channel,
      generation,
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
    if (created.error.code !== "version_conflict") return created;

    // Race-fallback: another request's create already won this generation's
    // id between our lookup and this create — the existing row already IS
    // the opt-out, so the race loser just reports success too.
    const afterRace = await lookup(
      db,
      input.tenantId,
      input.addressHash,
      input.notificationType,
      input.channel,
    );
    if (afterRace) return { isSuccess: true, data: input };

    // No row after the conflict: this generation's stream was deleted by a
    // prior resubscribe. Try the next generation instead of failing.
    lastFailure = created;
  }
  return lastFailure ?? { isSuccess: true, data: input };
}

/**
 * Resubscribe: hard-deletes the opt-out row so `isAddressOptedOut` reports
 * false again. Idempotent — no row means the address was never (or is no
 * longer) opted out, which is already the desired end state.
 *
 * Refuses to delete the row sitting at the last available id generation:
 * unsubscribe must always succeed, and once every generation below the cap
 * is dead, only a live row at the last generation still guarantees that
 * (upsertAddressOptOut's existing-row check, no generation loop needed).
 */
export async function removeAddressOptOut(
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
  if (!existing) return { isSuccess: true, data: input };

  const lastGenerationId = addressOptOutAggregateId(
    input.tenantId,
    input.addressHash,
    input.notificationType,
    input.channel,
    MAX_ADDRESS_OPT_OUT_GENERATIONS - 1,
  );
  if (existing.id === lastGenerationId) {
    return writeFailure(
      new ConflictError({
        message: "resubscribe limit reached: this address must stay opted out",
        i18nKey: "delivery.errors.resubscribeLimitReached",
        details: { reason: DeliveryErrors.resubscribeLimitReached },
      }),
    );
  }

  const deleted = await executor.delete({ id: existing.id }, actor, db);
  if (!deleted.isSuccess) return deleted;
  return { isSuccess: true, data: input };
}
