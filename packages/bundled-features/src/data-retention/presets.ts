// Retention-Presets — vorgefertigte Bündel von per-Entity-Aufbewahrungs-
// Konfigurationen pro Compliance-Regime. Tenant-Admin wählt EINES (analog
// zu compliance-profiles); Entity-Default + Tenant-Override liegen als
// Schichten 1+3 darüber (siehe resolver.ts).
//
// Plan-Roadmap docs/plans/datenschutz/core-data-retention.md hat 8 Presets
// vorgeschlagen. Sprint-2-MVP: 3 Production-Presets + 1 dev-Default,
// rest folgt on-demand wenn Customer fragt.
//
// Presets sind pure Daten — keine Logik. Erweitern = Constant erweitern,
// kein Code-Eingriff.

import type { RetentionDef } from "@cosmicdrift/kumiko-framework/engine";

/**
 * Pro Entity-Name gemappte Retention-Policy. Entity-Namen sind der
 * String aus r.entity("name", ...) — kebab-case oder lowercase.
 * Cleanup-Job iteriert alle bekannten Entities; was nicht im Preset
 * steht, fällt auf Entity-Default (Layer 1) zurück.
 */
export type RetentionPreset = Readonly<Record<string, RetentionDef>>;

export type RetentionPresetKey = "default" | "dsgvo-basic" | "dsgvo-hgb" | "swiss-dsg";

/**
 * MVP-Set für Sprint 2. Erweiterungen (hipaa, ccpa, aggressive-gdpr,
 * pipeda-default, ca-quebec-l25) kommen on-demand.
 */
export const RETENTION_PRESETS: Readonly<Record<RetentionPresetKey, RetentionPreset>> = {
  // Default — keine Auto-Aktion. Nur sinnvoll für Dev/Staging.
  // Production-Tenant der "default" stehen lässt → Cleanup-Job
  // schreibt Audit-Eintrag "skipped: no preset selected".
  default: {},

  // DSGVO Basic — Datenminimierung ohne Buchhaltungspflichten.
  "dsgvo-basic": {
    auditLog: { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
    session: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
    httpLog: { keepFor: "90d", strategy: "hardDelete", reference: "createdAt" },
  },

  // DSGVO + HGB — deutsche Aufbewahrungspflichten überlagert. Order
  // wird anonymisiert (PII raus, Geschäftsdaten bleiben), Invoice +
  // Booking sind blockDelete bis 10 Jahre, dann Anonymize.
  "dsgvo-hgb": {
    auditLog: { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
    session: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
    httpLog: { keepFor: "90d", strategy: "hardDelete", reference: "createdAt" },
    invoice: { keepFor: "10y", strategy: "blockDelete", reference: "createdAt" },
    booking: { keepFor: "10y", strategy: "blockDelete", reference: "createdAt" },
    contract: { keepFor: "6y", strategy: "blockDelete", reference: "createdAt" },
    order: { keepFor: "6y", strategy: "anonymize", reference: "completedAt" },
  },

  // Schweizer DSG — ähnlich DSGVO mit OR Art. 958f Aufbewahrung.
  "swiss-dsg": {
    auditLog: { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
    session: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
    invoice: { keepFor: "10y", strategy: "blockDelete", reference: "createdAt" },
  },
} satisfies Readonly<Record<RetentionPresetKey, RetentionPreset>>;

/**
 * Auswählbare Presets für den Onboarding-Banner. "default" ist Migration-
 * Edge-Case und wird nicht angezeigt — Production-Tenants wählen ein
 * echtes Preset.
 */
export const SELECTABLE_RETENTION_PRESETS: readonly RetentionPresetKey[] = [
  "dsgvo-basic",
  "dsgvo-hgb",
  "swiss-dsg",
];
