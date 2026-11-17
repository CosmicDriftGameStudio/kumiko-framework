import type { DbConnection, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  isTenantServingPublicContent,
  type TenantLifecycleStatus,
  tenantTable,
} from "../tenant/index.ts";
import type { HostRoutingOptions } from "./options.ts";

type TenantRow = {
  readonly id: TenantId;
  readonly isEnabled: boolean;
  readonly status: TenantLifecycleStatus;
};

// Disabled tenants and tenants in any destroy phase are not routable, the same
// rule public files and pages follow.
export async function servingTenantIdByKey(
  db: DbConnection | TenantDb,
  key: string,
): Promise<TenantId | null> {
  const row = await fetchOne<TenantRow>(db, tenantTable, { key });
  return row !== undefined && isTenantServingPublicContent(row) ? row.id : null;
}

export async function isTenantServing(db: DbConnection | TenantDb, id: TenantId): Promise<boolean> {
  const row = await fetchOne<TenantRow>(db, tenantTable, { id });
  return row !== undefined && isTenantServingPublicContent(row);
}

export async function servingTenantIdByResolver(
  options: HostRoutingOptions,
  db: DbConnection | TenantDb,
  hostname: string,
): Promise<TenantId | null> {
  if (typeof options.tenantBy !== "function") return null;
  const resolved = await options.tenantBy(hostname, db);
  return resolved !== null && (await isTenantServing(db, resolved)) ? resolved : null;
}
