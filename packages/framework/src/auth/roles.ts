// Zentrale Role-Konstanten der Plattform.
//
// Hintergrund: Bundled-Features driften zwischen "Admin" (text-content,
// secrets, ai-foundation, file-provider-s3) und "TenantAdmin" (tenant-
// handler, publicstatus, platform). App-Builder fallen in diese Falle.
// Diese Datei ist die Single Source of Truth — Bundled-Features
// migrieren schrittweise auf die ROLES-Constants in den Sprint-
// Touchpoints, an denen sie ohnehin angefasst werden.
//
// Canonical-Names:
//   TenantOwner            — Volle Tenant-Hoheit, einzige Rolle die
//                            Tenant-Destroy triggern darf.
//   TenantAdmin            — Tenant-Konfiguration + User-Management.
//                            Bestehender String "Admin" wird hierauf
//                            migriert.
//   DataProtectionOfficer  — DPO; setzt Legal-Holds, sieht Authority-
//                            Audit-Stream auch im silentMode (Sprint 6).
//   PlatformAdmin          — Plattform-Operator (NICHT Tenant-scoped).
//                            Authority-Export, KMS-Recovery, etc.
//   Member                 — Standard-Mitglied eines Tenants ohne
//                            Admin-Rechte.

/**
 * Plattform-weit standardisierte Role-Namen. Alle Datenschutz-Sprints
 * (1+) nutzen ausschliesslich diese Constants statt String-Literale.
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
