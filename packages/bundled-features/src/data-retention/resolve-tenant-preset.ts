// Leitet den Layer-2 Retention-Preset eines Tenants aus seinem Compliance-
// Profile ab. Der retention-cleanup-Cron ruft das pro fan-out-Tenant.
//
// **Soft-Dependency:** data-retention bleibt standalone-mountbar. Nur wenn
// compliance-profiles mit-gemountet ist (seine Entity registriert), wird ein
// Preset abgeleitet — sonst null, dann greifen ausschliesslich Entity-Defaults
// (Layer 1) + per-Entity Tenant-Overrides (Layer 3). Kein r.requires, damit
// eine App data-retention auch ohne Compliance-Profiles nutzen kann.
//
// Die Map ist intentional: Compliance-Profile (Region) und Retention-Preset
// sind beide um dieselben drei Regimes gebaut (EU/CH/DE-HGB). swiss-dsg ist
// sogar namensgleich. minimal-no-region → "default" (No-Op-Preset).

import type { ComplianceProfileKey } from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resolveProfileForTenant } from "../compliance-profiles";
import type { RetentionPresetKey } from "./presets";

// r.entity-Name aus compliance-profiles/feature.ts — Probe ob das Feature
// gemountet ist, bevor wir seine Tabelle lesen (sonst wirft fetchOne).
const COMPLIANCE_PROFILE_ENTITY = "tenant-compliance-profile";

const PROFILE_TO_PRESET: Readonly<Record<ComplianceProfileKey, RetentionPresetKey>> = {
  "eu-dsgvo": "dsgvo-basic",
  "de-hr-dsgvo-hgb": "dsgvo-hgb",
  "swiss-dsg": "swiss-dsg",
  "minimal-no-region": "default",
} satisfies Readonly<Record<ComplianceProfileKey, RetentionPresetKey>>;

export interface ResolveTenantPresetArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
}

export async function resolveTenantRetentionPreset(
  args: ResolveTenantPresetArgs,
): Promise<RetentionPresetKey | null> {
  if (!args.registry.getEntity(COMPLIANCE_PROFILE_ENTITY)) {
    return null;
  }
  // resolveProfileForTenant liest die 1:1-Profile-Row des Tenants (boot-DB,
  // by tenantId gefiltert) und faellt auf minimal-no-region zurueck wenn der
  // Tenant noch kein Profile gewaehlt hat.
  const effective = await resolveProfileForTenant({ db: args.db, tenantId: args.tenantId });
  return PROFILE_TO_PRESET[effective.profile.key] ?? null;
}

// Exportiert fuer den Unit-Test (Map-Vollstaendigkeit gegen ComplianceProfileKey).
export { PROFILE_TO_PRESET };
