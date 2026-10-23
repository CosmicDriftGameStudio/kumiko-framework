import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { TenantQueries } from "../../tenant/index.ts";
import type { TemplateResourceRow } from "../table.ts";

export const TENANT_OVERRIDES_REASON =
  "SystemAdmin template overview lists which tenants override one system template; it reads tenant-scope template rows of every tenant (and the system row for the optional per-tenant diff), which the tenant-scoped db cannot reach";

const tenantIdsSchema = z.array(z.string());

type TenantIdQueryContext = {
  readonly registry: { getQueryHandler(name: string): unknown };
  readonly dispatch: {
    readonly query: (name: string, payload: Record<string, never>) => Promise<unknown>;
  };
};

/** Null when the tenant feature is not installed: every tenant row then counts. */
export async function loadEnabledTenantIds(
  ctx: TenantIdQueryContext,
): Promise<ReadonlySet<string> | null> {
  if (ctx.registry.getQueryHandler(TenantQueries.activeTenantIds) === undefined) return null;
  return new Set(
    tenantIdsSchema.parse(await ctx.dispatch.query(TenantQueries.activeTenantIds, {})),
  );
}

export type OverrideCandidate = Pick<TemplateResourceRow, "tenantId" | "status" | "version">;

// One row per tenant: its active override wins over a draft, then the newest version.
function isBetterRow(candidate: OverrideCandidate, current: OverrideCandidate): boolean {
  if ((candidate.status === "active") !== (current.status === "active")) {
    return candidate.status === "active";
  }
  return candidate.version > current.version;
}

function isCountedTenantRow(
  row: OverrideCandidate,
  enabledTenantIds: ReadonlySet<string> | null,
): boolean {
  if (row.tenantId === SYSTEM_TENANT_ID || row.status === "archived") return false;
  return enabledTenantIds === null || enabledTenantIds.has(row.tenantId);
}

export function pickBestRowPerTenant<TRow extends OverrideCandidate>(
  found: readonly TRow[],
  enabledTenantIds: ReadonlySet<string> | null,
): Map<string, TRow> {
  const bestByTenant = new Map<string, TRow>();
  for (const row of found) {
    if (!isCountedTenantRow(row, enabledTenantIds)) continue;
    const current = bestByTenant.get(row.tenantId);
    if (current === undefined || isBetterRow(row, current)) bestByTenant.set(row.tenantId, row);
  }
  return bestByTenant;
}
