// Three-layer retention resolver.
//
// Layer 1: Entity default       — Feature author sets r.entity({retention})
// Layer 2: Tenant preset        — Tenant admin selects a bundle (RETENTION_PRESETS)
// Layer 3: Tenant override      — per (tenantId, entityName) JSON override
//
// Resolution order:
//   effective = override(tenantId, entityName)
//             ?? preset[tenant.retentionPreset][entityName]
//             ?? entity.retention   (code default from EntityDefinition)
//             ?? null               (no automatic action)
//
// The cleanup job resolves this for each (tenantId, entityName) and
// decides what to do (hardDelete / softDelete / anonymize /
// blockDelete with a grace-period check).
//
// The cross-feature API r.exposesApi("retention.policyFor")
// makes this consumable by user-data-rights — the forget flow
// queries blockDelete fields and anonymizes them instead of deleting them.

import type { EntityDefinition, RetentionDef } from "@cosmicdrift/kumiko-framework/engine";
import { RETENTION_PRESETS, type RetentionPresetKey } from "./presets.ts";

/**
 * Raw override from the database table (the config column as a JSON string).
 * Unlike RetentionDef, every property is optional because an override may
 * replace individual properties.
 */
export interface RetentionOverride {
  readonly keepFor?: string;
  readonly strategy?: RetentionDef["strategy"];
  readonly reference?: string;
}

/**
 * Effective policy after the resolver ran. `source` records WHICH layer
 * supplied the value, as an audit trail for the DPO.
 *
 * `override-incomplete` means a tenant override is set but fills keepFor
 * neither itself nor through the preset/entity fallback. The cleanup job
 * logs a warning and skips instead of deleting everything at once with a
 * default "0d".
 */
export interface EffectiveRetentionPolicy {
  readonly entityName: string;
  readonly policy: RetentionDef | null;
  readonly source: "override" | "preset" | "entity-default" | "none" | "override-incomplete";
}

export interface ResolveRetentionPolicyArgs {
  readonly entityName: string;
  readonly entityDef: EntityDefinition | null;
  readonly tenantPreset: RetentionPresetKey | null;
  readonly tenantOverride: RetentionOverride | null;
}

/**
 * Resolves the three layers. This is a pure function with no database
 * access; the caller supplies all inputs (the cleanup job aggregates them
 * per tenant beforehand).
 */
export function resolveRetentionPolicy(args: ResolveRetentionPolicyArgs): EffectiveRetentionPolicy {
  const { entityName, entityDef, tenantPreset, tenantOverride } = args;

  // Layer 3: Override wins, but it may omit fields, which then
  // fall back to the individual properties from Layer 2 or 1.
  if (tenantOverride !== null) {
    const baseFromPreset =
      tenantPreset !== null ? (RETENTION_PRESETS[tenantPreset]?.[entityName] ?? null) : null;
    const baseFromEntity = entityDef?.retention ?? null;
    const base = baseFromPreset ?? baseFromEntity;

    const keepFor = tenantOverride.keepFor ?? base?.keepFor;
    const strategy = tenantOverride.strategy ?? base?.strategy;

    // keepFor + strategy are required for every active policy. If
    // neither the override nor the base supplies them, the override is
    // semantically incomplete — the cleanup job must warn instead of
    // immediately deleting everything with the default "0d". The source
    // marker documents this.
    if (keepFor === undefined || strategy === undefined) {
      return { entityName, policy: null, source: "override-incomplete" };
    }

    const merged: RetentionDef = {
      keepFor,
      strategy,
      reference: tenantOverride.reference ?? base?.reference,
    };
    return { entityName, policy: merged, source: "override" };
  }

  // Layer 2: Preset
  if (tenantPreset !== null) {
    const fromPreset = RETENTION_PRESETS[tenantPreset]?.[entityName];
    if (fromPreset) {
      return { entityName, policy: fromPreset, source: "preset" };
    }
  }

  // Layer 1: Entity-Default
  if (entityDef?.retention) {
    return { entityName, policy: entityDef.retention, source: "entity-default" };
  }

  // No policy is defined, so the cleanup job skips this entity for this tenant.
  return { entityName, policy: null, source: "none" };
}
