import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { StoredEnvelope } from "../../table";

export async function selectTenantSecretEnvelope(
  db: DbRunner,
  tenantId: TenantId,
  key: string,
): Promise<StoredEnvelope | undefined> {
  const rows = await asRawClient(db).unsafe<{ envelope: StoredEnvelope }>(
    `SELECT envelope FROM read_tenant_secrets WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, key],
  );
  return rows[0]?.envelope;
}
