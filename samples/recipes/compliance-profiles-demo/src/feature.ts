// Compliance-Profiles Demo
//
// Same App-Code, two different tenants, two different DSGVO-Profile —
// das ist die Sales-Story von Compliance-Profiles. Tenant-Admin waehlt
// einmal beim Onboarding, danach laufen alle User-Rights-Grace-Periods,
// Notification-Sprachen, Breach-Disclosure-Pflichten und Audit-Log-
// Retentions automatisch profil-spezifisch.
//
// Demo-Szenario:
//   Tenant A (DACH-Customer)        → eu-dsgvo
//     - 30d Grace-Period fuer Forget
//     - DE/EN-Notifications
//     - Aufsicht: BlnBDI Berlin
//
//   Tenant B (Swiss-Customer)       → swiss-dsg
//     - 30d Grace-Period (geerbt aus eu-dsgvo via extends)
//     - DE/FR/IT/EN-Notifications
//     - Aufsicht: EDÖB Bern
//
// Beide Tenants laufen auf derselben App-Instance. Das compliance-
// profiles-Feature haelt den Profile-State pro Tenant; jedes consumer-
// Feature ruft `compliance.forTenant` (Sprint 2+) und sieht das
// effektive Profile fuer den aktuellen Tenant.

import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";

export const complianceProfilesDemoFeatures = [createComplianceProfilesFeature()];
