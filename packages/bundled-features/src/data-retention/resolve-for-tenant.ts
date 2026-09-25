// Single implementation of the three-layer policy resolution: the cleanup cron,
// the forget runner and the `policy-for` query all go through here, so a caller
// cannot skip a layer (e.g. the tenant preset) by accident.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { isTenantDb } from "../shared";
import { parseRetentionOverrideOrNull } from "./_internal/parse-override";
import type { RetentionPresetKey } from "./presets";
import { resolveTenantRetentionPreset } from "./resolve-tenant-preset";
import { type EffectiveRetentionPolicy, resolveRetentionPolicy } from "./resolver";
import { tenantRetentionOverrideTable } from "./schema/tenant-retention-override";

export interface ResolveForTenantArgs {
  // fw#2914 — a EXT_USER_DATA hook's ctx.db is a TenantDb (method-form);
  // the cleanup cron's own db is still a raw DbRunner. Both are valid here —
  // this lookup is a plain tenant-scoped read either way.
  readonly db: DbRunner | TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly entityName: string;
  /**
   * Layer 2 — Tenant-Preset. `undefined` (the default) means this resolver
   * derives it itself via resolveTenantRetentionPreset — one compliance-
   * profile read per call, fine for single-lookup callers (`policy-for`, a
   * per-hook TenantDb caller like notes-history-user-data). A bulk caller
   * iterating N entities × M tenants (the forget-cleanup runner, the
   * retention-cleanup cron) MUST resolve it ONCE per tenant and pass it in
   * here instead, or it re-derives per entity. `null` means "resolved
   * already, no preset applies" — the resolver falls back to Entity-Default
   * (Layer 1) + Tenant-Override (Layer 3).
   */
  readonly preloadedTenantPreset?: RetentionPresetKey | null;
  /**
   * Pre-fetched override row for this (tenantId, entityName) pair — lets a
   * bulk caller (the cleanup cron, N entities × M tenants) read every
   * override for a tenant ONCE and pass each row in, instead of one
   * `fetchOne` per entity. undefined (the default) still runs the
   * single-lookup fetchOne for the "policy-for" query handler's use case.
   * `null` explicitly means "pre-fetched, no override row exists".
   */
  readonly preloadedOverride?: { config: string | null } | null;
}

export async function resolveRetentionPolicyForTenant(
  args: ResolveForTenantArgs,
): Promise<EffectiveRetentionPolicy> {
  const overrideRow =
    args.preloadedOverride !== undefined
      ? args.preloadedOverride
      : isTenantDb(args.db)
        ? ((await args.db.fetchOne<{ config: string | null }>(tenantRetentionOverrideTable, {
            tenantId: args.tenantId,
            entityName: args.entityName,
          })) ?? null)
        : ((await fetchOne(args.db, tenantRetentionOverrideTable, {
            tenantId: args.tenantId,
            entityName: args.entityName,
          })) as { config: string | null } | null); // @cast-boundary db-runner

  const tenantOverride = parseRetentionOverrideOrNull(
    overrideRow?.config ?? null,
    args.tenantId,
    "data-retention:resolve-for-tenant",
  );

  const entityDef = args.registry.getEntity(args.entityName) ?? null;

  const tenantPreset =
    args.preloadedTenantPreset !== undefined
      ? args.preloadedTenantPreset
      : await resolveTenantRetentionPreset({
          db: args.db,
          registry: args.registry,
          tenantId: args.tenantId,
        });

  return resolveRetentionPolicy({
    entityName: args.entityName,
    entityDef,
    tenantPreset,
    tenantOverride,
  });
}
