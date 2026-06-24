// Direkter Resolver-Helper fuer Bulk-Iteration (S2.U5b Cleanup-Runner).
//
// `policy-for` Query (handlers/policy-for.query.ts) ist die Cross-Feature-
// API fuer einzelne Lookups. Der Cleanup-Runner iteriert N Entities × M
// Tenants — Handler-Roundtrip pro Lookup waere zu teuer + braucht einen
// HandlerContext. Beide Pfade nutzen denselben `parseRetentionOverrideOrNull`
// + `resolveRetentionPolicy`, also kein Drift-Risiko.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { parseRetentionOverrideOrNull } from "./_internal/parse-override";
import type { RetentionPresetKey } from "./presets";
import { type EffectiveRetentionPolicy, resolveRetentionPolicy } from "./resolver";
import { tenantRetentionOverrideTable } from "./schema/tenant-retention-override";

export interface ResolveForTenantArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly entityName: string;
  /**
   * Layer 2 — Tenant-Preset, vom Caller aufgeloest (retention-cleanup-Cron
   * leitet ihn aus dem Compliance-Profile ab, siehe resolve-tenant-preset.ts).
   * null = kein Preset, Resolver faellt auf Entity-Default (Layer 1) +
   * Tenant-Override (Layer 3) zurueck.
   */
  readonly tenantPreset?: RetentionPresetKey | null;
}

export async function resolveRetentionPolicyForTenant(
  args: ResolveForTenantArgs,
): Promise<EffectiveRetentionPolicy> {
  const overrideRow = (await fetchOne(args.db, tenantRetentionOverrideTable, {
    tenantId: args.tenantId,
    entityName: args.entityName,
  })) as { config: string | null } | null; // @cast-boundary db-runner

  const tenantOverride = parseRetentionOverrideOrNull(
    overrideRow?.config ?? null,
    args.tenantId,
    "data-retention:resolve-for-tenant",
  );

  const entityDef = args.registry.getEntity(args.entityName) ?? null;

  return resolveRetentionPolicy({
    entityName: args.entityName,
    entityDef,
    tenantPreset: args.tenantPreset ?? null,
    tenantOverride,
  });
}
