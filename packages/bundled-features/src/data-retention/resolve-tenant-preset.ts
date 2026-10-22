// Derives a tenant's Layer-2 retention preset from its compliance profile.
// The retention-cleanup cron calls this once per fan-out tenant.
//
// **Soft dependency:** data-retention remains mountable standalone. A preset is
// derived only when compliance-profiles is mounted as well (its entity is
// registered); otherwise this returns null, leaving only entity defaults
// (Layer 1) and per-entity tenant overrides (Layer 3). No r.requires is used,
// so an app can use data-retention without compliance-profiles.
//
// The mapping is intentional: compliance profiles (regions) and retention
// presets are both built around the same three regimes (EU/CH/DE-HGB).
// swiss-dsg even has the same name. minimal-no-region maps to "default"
// (a no-op preset).

import type { ComplianceProfileKey } from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resolveProfileForTenant } from "../compliance-profiles/index.ts";
import type { RetentionPresetKey } from "./presets.ts";

// Entity name from compliance-profiles/feature.ts — check that the feature is
// mounted before reading its table; otherwise fetchOne throws.
const COMPLIANCE_PROFILE_ENTITY = "tenant-compliance-profile";

const PROFILE_TO_PRESET: Readonly<Record<ComplianceProfileKey, RetentionPresetKey>> = {
  "eu-dsgvo": "dsgvo-basic",
  "de-hr-dsgvo-hgb": "dsgvo-hgb",
  "swiss-dsg": "swiss-dsg",
  "minimal-no-region": "default",
} satisfies Readonly<Record<ComplianceProfileKey, RetentionPresetKey>>;

export interface ResolveTenantPresetArgs {
  // resolveRetentionPolicyForTenant calls this itself when its own
  // caller omits preloadedTenantPreset. Its `db` is DbRunner | TenantDb (bulk
  // cron vs. per-hook TenantDb), so this must accept both too.
  readonly db: DbRunner | TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
}

export async function resolveTenantRetentionPreset(
  args: ResolveTenantPresetArgs,
): Promise<RetentionPresetKey | null> {
  if (!args.registry.getEntity(COMPLIANCE_PROFILE_ENTITY)) {
    return null;
  }
  // resolveProfileForTenant reads the tenant's 1:1 profile row from the boot DB,
  // filtered by tenantId, and falls back to minimal-no-region when the tenant
  // has not selected a profile yet.
  const effective = await resolveProfileForTenant({ db: args.db, tenantId: args.tenantId });
  return PROFILE_TO_PRESET[effective.profile.key] ?? null;
}

// Exported for the unit test that checks completeness against ComplianceProfileKey.
export { PROFILE_TO_PRESET };
