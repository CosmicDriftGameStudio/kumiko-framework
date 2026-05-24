import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type ConfigRow = {
  readonly id: string;
  readonly key: string;
  readonly value: string | null;
  readonly tenantId: TenantId;
  readonly userId: string | null;
};

export async function selectConfigRowsForScope(
  db: DbRunner,
  systemTenantId: TenantId,
  tenantId: TenantId,
  userId: string,
): Promise<readonly ConfigRow[]> {
  return asRawClient(db).unsafe<ConfigRow>(
    `SELECT id, key, value, tenant_id AS "tenantId", user_id AS "userId"
     FROM read_config_values
     WHERE (tenant_id = $1 AND user_id IS NULL)
        OR (tenant_id = $2 AND user_id IS NULL)
        OR (tenant_id = $2 AND user_id = $3)`,
    [systemTenantId, tenantId, userId],
  );
}

export async function selectConfigRowsForKeys(
  db: DbRunner,
  keys: readonly string[],
  systemTenantId: TenantId,
  tenantId: TenantId,
  userId: string,
): Promise<readonly ConfigRow[]> {
  return asRawClient(db).unsafe<ConfigRow>(
    `SELECT id, key, value, tenant_id AS "tenantId", user_id AS "userId"
     FROM read_config_values
     WHERE key = ANY($1)
       AND (
         (tenant_id = $2 AND user_id IS NULL)
         OR (tenant_id = $3 AND user_id IS NULL)
         OR (tenant_id = $3 AND user_id = $4)
       )`,
    [[...keys], systemTenantId, tenantId, userId],
  );
}
