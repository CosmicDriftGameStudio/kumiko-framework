import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { configValuesTable } from "../../table";

export type ConfigRow = {
  readonly id: string;
  readonly key: string;
  readonly value: string | null;
  readonly tenantId: TenantId;
  readonly userId: string | null;
};

// Method-form so a tenant-mode TenantDb stays filtered.
export async function selectConfigRowsForScope(
  db: DbRunner | TenantDb,
  systemTenantId: TenantId,
  tenantId: TenantId,
  userId: string,
): Promise<readonly ConfigRow[]> {
  const [scopeRows, userRows] = await Promise.all([
    selectMany<ConfigRow>(db, configValuesTable, {
      tenantId: [systemTenantId, tenantId],
      userId: null,
    }),
    selectMany<ConfigRow>(db, configValuesTable, { tenantId, userId }),
  ]);
  return [...scopeRows, ...userRows];
}

export async function selectConfigRowsForKeys(
  db: DbRunner | TenantDb,
  keys: readonly string[],
  systemTenantId: TenantId,
  tenantId: TenantId,
  userId: string,
): Promise<readonly ConfigRow[]> {
  if (keys.length === 0) return [];
  const keyFilter = { in: [...keys] };
  const [scopeRows, userRows] = await Promise.all([
    selectMany<ConfigRow>(db, configValuesTable, {
      key: keyFilter,
      tenantId: [systemTenantId, tenantId],
      userId: null,
    }),
    selectMany<ConfigRow>(db, configValuesTable, { key: keyFilter, tenantId, userId }),
  ]);
  return [...scopeRows, ...userRows];
}
