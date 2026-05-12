// Direkter Resolver-Helper fuer Bulk-Iteration ohne dispatcher-Roundtrip.
//
// `for-tenant`-Query (handlers/for-tenant.query.ts) ist die Cross-Feature-
// API fuer Handler-Pfade. Worker (S2.U3 Atom 3b) lebt im JobContext
// ohne `queryAs` — braucht direkten DB-Lookup + resolveComplianceProfile.
//
// Pattern matched data-retention's `resolveRetentionPolicyForTenant`.
// Beide Pfade nutzen `resolveComplianceProfile` aus framework/compliance,
// also kein Drift zwischen Query-API und Worker-Pfad.

import {
  type ComplianceProfileKey,
  type ComplianceProfileOverride,
  type EffectiveComplianceProfile,
  resolveComplianceProfile,
} from "@cosmicdrift/kumiko-framework/compliance";
import { type DbRunner, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { tenantComplianceProfileTable } from "./schema/profile-selection";

export interface ResolveProfileForTenantArgs {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
}

export async function resolveProfileForTenant(
  args: ResolveProfileForTenantArgs,
): Promise<EffectiveComplianceProfile> {
  const row = (await fetchOne(
    args.db,
    tenantComplianceProfileTable,
    eq(tenantComplianceProfileTable["tenantId"], args.tenantId),
  )) as { profileKey: string; override: string | null } | null;

  if (!row) {
    return resolveComplianceProfile({});
  }

  const override = parseOverride(row.override, args.tenantId);
  return resolveComplianceProfile({
    selection: row.profileKey as ComplianceProfileKey,
    override,
  });
}

function parseOverride(
  raw: string | null,
  tenantId: string,
): ComplianceProfileOverride | undefined {
  if (!raw || raw.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed as ComplianceProfileOverride; // @cast-boundary engine-payload
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    // biome-ignore lint/suspicious/noConsole: operator visibility for DB-corruption edge-case
    console.warn(
      `[compliance-profiles:resolve-for-tenant] tenant ${tenantId}: stored override is not valid JSON, ignoring. Reason: ${reason}`,
    );
    return undefined;
  }
}
