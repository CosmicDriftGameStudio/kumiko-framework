import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// Exact match only — unlike notification-preferences there is no wildcard
// ("*") semantics for address opt-outs, the token that creates a row always
// carries one concrete notificationType/channel pair.
export async function isAddressOptedOut(
  db: DbConnection,
  tenantId: TenantId,
  addressHash: string,
  notificationType: string,
  channel: string,
): Promise<boolean> {
  const rows = await unsafeReadRetrying<{ readonly id: string }>(
    db,
    `SELECT id FROM read_notification_address_opt_outs
     WHERE tenant_id = $1 AND address_hash = $2 AND notification_type = $3 AND channel = $4
     LIMIT 1`,
    [tenantId, addressHash, notificationType, channel],
  );
  return rows.length > 0;
}
