// Retention presets — predefined bundles of per-entity retention
// configurations for each compliance regime. The tenant admin selects ONE
// (analogous to compliance profiles); the entity default and tenant override
// are layered above it as layers 1 and 3 (see resolver.ts).
//
// The presets are pure data with no logic. Extending them means extending the
// constant; no code changes are required.

import type { RetentionDef } from "@cosmicdrift/kumiko-framework/engine";

/**
 * Retention policy keyed by entity name, i.e. the `name` from
 * r.entity({ name, ... }) (kebab-case or lowercase). The cleanup job walks
 * all known entities; anything missing from the preset falls back to the
 * entity default (layer 1).
 */
export type RetentionPreset = Readonly<Record<string, RetentionDef>>;

export type RetentionPresetKey = "default" | "dsgvo-basic" | "dsgvo-hgb" | "swiss-dsg";

/**
 * Available presets. Additional options (hipaa, ccpa, aggressive-gdpr,
 * pipeda-default, ca-quebec-l25) can be added on demand.
 */
export const RETENTION_PRESETS: Readonly<Record<RetentionPresetKey, RetentionPreset>> = {
  // Default — no automatic action; intended only for Dev/Staging.
  // A production tenant that leaves `default` selected causes the cleanup job
  // to write the audit entry "skipped: no preset selected".
  default: {},

  // DSGVO Basic — data minimization without accounting retention obligations.
  "dsgvo-basic": {
    "audit-log": { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
    session: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
    "http-log": { keepFor: "90d", strategy: "hardDelete", reference: "createdAt" },
  },

  // DSGVO + HGB — German statutory retention obligations take precedence.
  // Orders are anonymized (PII removed while business data remains); invoices
  // and bookings are blockDelete for up to 10 years, then anonymized.
  "dsgvo-hgb": {
    "audit-log": { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
    session: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
    "http-log": { keepFor: "90d", strategy: "hardDelete", reference: "createdAt" },
    invoice: { keepFor: "10y", strategy: "blockDelete", reference: "createdAt" },
    booking: { keepFor: "10y", strategy: "blockDelete", reference: "createdAt" },
    contract: { keepFor: "6y", strategy: "blockDelete", reference: "createdAt" },
    order: { keepFor: "6y", strategy: "anonymize", reference: "completedAt" },
  },

  // Swiss DSG — similar to DSGVO, with retention under OR Art. 958f.
  "swiss-dsg": {
    "audit-log": { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
    session: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
    invoice: { keepFor: "10y", strategy: "blockDelete", reference: "createdAt" },
  },
} satisfies Readonly<Record<RetentionPresetKey, RetentionPreset>>;

/**
 * Presets available in the onboarding banner. `default` is a migration edge
 * case and is not displayed; production tenants must choose an actual preset.
 */
export const SELECTABLE_RETENTION_PRESETS: readonly RetentionPresetKey[] = [
  "dsgvo-basic",
  "dsgvo-hgb",
  "swiss-dsg",
];
