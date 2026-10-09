import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { notificationAddressOptOutsTable } from "../../tables.js";

export type AddressOptOutKey = string;

export function addressOptOutKey(addressHash: string, channel: string): AddressOptOutKey {
  return `${addressHash}|${channel}`;
}

// Exact match only — unlike notification-preferences there is no wildcard
// ("*") semantics for address opt-outs, the token that creates a row always
// carries one concrete notificationType/channel pair. One query covers every
// recipient of a notify() call.
export async function selectOptedOutAddresses(
  db: DbConnection,
  tenantId: TenantId,
  notificationType: string,
  addressHashes: readonly string[],
): Promise<ReadonlySet<AddressOptOutKey>> {
  if (addressHashes.length === 0) return new Set();
  const rows = await selectMany<{ readonly addressHash: string; readonly channel: string }>(
    db,
    notificationAddressOptOutsTable,
    { tenantId, notificationType, addressHash: { in: addressHashes } },
  );
  return new Set(rows.map((row) => addressOptOutKey(row.addressHash, row.channel)));
}
