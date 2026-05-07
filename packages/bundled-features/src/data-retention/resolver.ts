// 3-Schicht-Retention-Resolver.
//
// Layer 1: Entity-Default       — Feature-Author setzt r.entity({retention})
// Layer 2: Tenant-Preset        — Tenant-Admin wählt Bundle (RETENTION_PRESETS)
// Layer 3: Tenant-Override      — per (tenantId, entityName) JSON-Override
//
// Resolver-Reihenfolge:
//   effective = override(tenantId, entityName)
//             ?? preset[tenant.retentionPreset][entityName]
//             ?? entity.retention   (Code-Default aus EntityDefinition)
//             ?? null               (keine Auto-Aktion)
//
// Cleanup-Job in S2.D2 ruft das pro (tenantId, entityName) und
// entscheidet was zu tun ist (hardDelete / softDelete / anonymize /
// blockDelete-mit-Frist-Check).
//
// Cross-Feature-API r.exposesApi("retention.policyFor") (S2.D3)
// macht das aus user-data-rights heraus konsumierbar — Forget-Flow
// fragt blockDelete-Felder ab + anonymisiert sie statt zu löschen.

import type { EntityDefinition, RetentionDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  RETENTION_PRESETS,
  type RetentionPresetKey,
} from "./presets";

/**
 * Roh-Override aus der DB-Tabelle (config-Spalte als JSON-String).
 * Nicht das gleiche wie RetentionDef weil hier alles optional ist —
 * Override darf einzelne Properties überschreiben.
 */
export interface RetentionOverride {
  readonly keepFor?: string;
  readonly strategy?: RetentionDef["strategy"];
  readonly reference?: string;
}

/**
 * Effektive Policy nach Resolver-Lauf. Source dokumentiert WELCHE
 * Schicht den Wert geliefert hat — Audit-Trail für DPO.
 *
 * `override-incomplete` bedeutet: Tenant-Override ist gesetzt, aber
 * füllt keepFor weder selbst noch via Preset-/Entity-Fallback.
 * Cleanup-Job logt eine Warning + skippt — anstatt mit Default-"0d"
 * sofort alles zu löschen.
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
 * Auswertung der drei Schichten. Pure Function — kein DB-Access, alle
 * Inputs werden vom Caller besorgt (Cleanup-Job aggregiert pro Tenant
 * vorher).
 */
export function resolveRetentionPolicy(
  args: ResolveRetentionPolicyArgs,
): EffectiveRetentionPolicy {
  const { entityName, entityDef, tenantPreset, tenantOverride } = args;

  // Layer 3: Override wins, aber Override darf Felder weglassen — dann
  // fallen die einzelnen Properties auf Layer 2/1 zurück.
  if (tenantOverride !== null) {
    const baseFromPreset =
      tenantPreset !== null ? (RETENTION_PRESETS[tenantPreset]?.[entityName] ?? null) : null;
    const baseFromEntity = entityDef?.retention ?? null;
    const base = baseFromPreset ?? baseFromEntity;

    const keepFor = tenantOverride.keepFor ?? base?.keepFor;
    const strategy = tenantOverride.strategy ?? base?.strategy;

    // keepFor + strategy sind Pflicht für jede aktive Policy. Wenn
    // weder Override noch Base sie liefert, ist das Override semantisch
    // unvollständig — Cleanup-Job soll WARNEN statt mit Default-"0d"
    // sofort alles löschen. Source-Marker dokumentiert das.
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

  // Nichts da — Cleanup-Job überspringt diese Entity für diesen Tenant.
  return { entityName, policy: null, source: "none" };
}
