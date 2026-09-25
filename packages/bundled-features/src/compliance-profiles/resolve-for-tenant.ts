// Direkter Resolver-Helper fuer Bulk-Iteration ohne dispatcher-Roundtrip.
//
// `for-tenant`-Query (handlers/for-tenant.query.ts) ist die Cross-Feature-
// API fuer Handler-Pfade. Worker (S2.U3 Atom 3b) lebt im JobContext
// ohne `queryAs` — braucht direkten DB-Lookup + resolveComplianceProfile.
//
// Pattern matched data-retention's `resolveRetentionPolicyForTenant`.
// Beide Pfade nutzen `resolveComplianceProfile` aus framework/compliance,
// also kein Drift zwischen Query-API und Worker-Pfad.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type ComplianceProfileKey,
  type EffectiveComplianceProfile,
  resolveComplianceProfile,
} from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { isTenantDb } from "../shared";
import { parseComplianceProfileOverride } from "./_internal/parse-override";
import { tenantComplianceProfileTable } from "./schema/profile-selection";

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
