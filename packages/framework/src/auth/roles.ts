// Zentrale Role-Konstanten der Plattform.
//
// Memory feedback_role_naming_drift: aktuell driften Bundled-Features
// zwischen "Admin" (text-content, secrets, ai-foundation, file-provider-s3)
// und "TenantAdmin" (tenant-handler, publicstatus, platform). App-Builder
// fallen in diese Falle. Diese Datei ist die Single Source of Truth —
// Bundled-Features migrieren schrittweise auf die ROLES-Constants.
//
// Canonical-Names:
//   TenantOwner            — Volle Tenant-Hoheit, einzige Rolle die
//                            Tenant-Destroy triggern darf.
//   TenantAdmin            — Tenant-Konfiguration + User-Management.
//                            "Admin" (legacy) ist ein Alias hierauf —
//                            wird bei Migration ersetzt.
//   DataProtectionOfficer  — DPO; setzt Legal-Holds, sieht Authority-
//                            Audit-Stream auch im silentMode (Sprint 6).
//   PlatformAdmin          — Plattform-Operator (NICHT Tenant-scoped).
//                            Authority-Export, KMS-Recovery, etc.
//   Member                 — Standard-Mitglied eines Tenants ohne
//                            Admin-Rechte.

/**
 * Plattform-weit standardisierte Role-Namen. Alle Datenschutz-Sprints
 * (1+) nutzen ausschliesslich diese Constants statt String-Literale.
 *
 * Bestehende Bundled-Features werden in ihren jeweiligen Sprint-
 * Touchpoints migriert (Memory: feedback_role_naming_drift). Bis zur
 * vollstaendigen Migration akzeptiert die Auth-Middleware sowohl
 * "Admin" (legacy) als auch "TenantAdmin" (canonical).
 */
export const ROLES = {
  TenantOwner: "TenantOwner",
  TenantAdmin: "TenantAdmin",
  DataProtectionOfficer: "DataProtectionOfficer",
  PlatformAdmin: "PlatformAdmin",
  Member: "Member",
} as const;

/**
 * Type-Union aller bekannten Role-Namen (Compile-Time-Check fuer
 * Handler-Access-Rules + Ownership-Maps).
 */
export type Role = (typeof ROLES)[keyof typeof ROLES];

/**
 * Legacy-Aliase die schrittweise migriert werden. Auth-Middleware
 * akzeptiert sie weiter, aber neue Code soll ROLES-Constants nutzen.
 */
export const ROLE_LEGACY_ALIASES: Readonly<Record<string, Role>> = {
  Admin: ROLES.TenantAdmin,
};
