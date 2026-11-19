import {
  COMPLIANCE_PROFILES,
  resolveComplianceProfile,
  subtractRetentionSpec,
} from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resolveProfileForTenant } from "../compliance-profiles/index.ts";

// Soft dependency: audit must stay mountable without compliance-profiles, so we probe its entity.
export const COMPLIANCE_PROFILE_ENTITY = "tenant-compliance-profile";

// Overrides may only lengthen retention: the earlier cutoff (same `now`) is the longer period.
export function earlierInstant(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) <= 0 ? a : b;
}

export async function resolveProfileAuditCutoff(
  db: DbRunner | TenantDb,
  tenantId: TenantId,
  now: Temporal.Instant,
): Promise<Temporal.Instant> {
  const { profile } = await resolveProfileForTenant({ db, tenantId });
  const effective = subtractRetentionSpec(now, profile.auditLog.retention);
  const base = subtractRetentionSpec(now, COMPLIANCE_PROFILES[profile.key].auditLog.retention);
  return earlierInstant(effective, base);
}

export async function resolveAuditRetentionCutoff(args: {
  readonly db: DbRunner | TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly now: Temporal.Instant;
}): Promise<Temporal.Instant> {
  // Without compliance-profiles its table does not exist, so the minimal profile applies.
  if (!args.registry.getEntity(COMPLIANCE_PROFILE_ENTITY)) {
    return subtractRetentionSpec(args.now, resolveComplianceProfile({}).profile.auditLog.retention);
  }
  return resolveProfileAuditCutoff(args.db, args.tenantId, args.now);
}
