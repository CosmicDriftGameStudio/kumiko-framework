// Direct resolver helper for bulk iteration without a dispatcher round trip.
//
// The `for-tenant` query (handlers/for-tenant.query.ts) is the cross-feature
// API for handler paths. Workers run in JobContext (without `queryAs`), so
// they need a direct database lookup followed by `resolveComplianceProfile`.
//
// This follows data-retention's `resolveRetentionPolicyForTenant` pattern.
// Both paths use `resolveComplianceProfile` from framework/compliance, keeping
// the query API and worker path consistent.

import {
  type ComplianceProfileKey,
  type EffectiveComplianceProfile,
  resolveComplianceProfile,
} from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { isTenantDb } from "../shared/index.ts";
import { parseComplianceProfileOverride } from "./_internal/parse-override.ts";
import { tenantComplianceProfileTable } from "./schema/profile-selection.ts";

export interface ResolveProfileForTenantArgs {
  // data-retention's resolveTenantRetentionPreset forwards this via
  // resolveRetentionPolicyForTenant, whose own `db` is DbRunner | TenantDb
  // (bulk cron vs. per-hook TenantDb). This lookup is a plain tenant-scoped
  // read either way.
  readonly db: DbRunner | TenantDb;
  readonly tenantId: TenantId;
}

export async function resolveProfileForTenant(
  args: ResolveProfileForTenantArgs,
): Promise<EffectiveComplianceProfile> {
  const row = isTenantDb(args.db)
    ? ((await args.db.fetchOne<{ profileKey: string; override: string | null }>(
        tenantComplianceProfileTable,
        { tenantId: args.tenantId },
      )) ?? null)
    : ((await fetchOne(args.db, tenantComplianceProfileTable, {
        tenantId: args.tenantId,
      })) as { profileKey: string; override: string | null } | null); // @cast-boundary db-runner

  if (!row) {
    return resolveComplianceProfile({});
  }

  const override = parseComplianceProfileOverride(
    row.override,
    args.tenantId,
    "compliance-profiles:resolve-for-tenant",
  );
  return resolveComplianceProfile({
    selection: row.profileKey as ComplianceProfileKey, // @cast-boundary engine-payload
    override,
  });
}
