// Zod-Schema fuer ComplianceProfileOverride mit .strict() rekursiv —
// Sprint 1.9 Z3.
//
// Vorher: set-profile.write.ts pruefte nur Top-Level-Keys gegen
// OVERRIDABLE_PROFILE_KEYS. Sub-Level-Tippfehler (z.B.
// `{ userRights: { weeks: 3 } }` statt `{ userRights: { gracePeriod: { days: 30 } } }`)
// kamen durch — der deepMerge spliced das nonsense ins effektive
// Profile, und ein Caller der `userRights.gracePeriod.days` liest
// crashed mit `undefined`.
//
// Lösung: Zod-Schema das die ComplianceProfile-Struktur in DeepPartial-
// Form abbildet, mit .strict() auf jedem Object damit unbekannte Keys
// werfen. Single source of truth wie OVERRIDABLE_PROFILE_KEYS, plus
// Sub-Level-Coverage.
//
// Identifikations-Felder (key, region, label, extends) sind NICHT im
// Schema — wer die overriden will, würde die Profile-Identitaet
// zerstören.

import { z } from "zod";

// DurationSpec: { days } | { hours } — strict bedeutet beide Forms
// muessen exakt 1 property haben (kein "{ days: 30, hours: 1 }").
const durationSpecSchema = z.union([
  z.object({ days: z.number().int().nonnegative() }).strict(),
  z.object({ hours: z.number().int().nonnegative() }).strict(),
]);

// retention.* erlaubt zusaetzlich "months" und "years". Wieder eine
// strikte Disjunktion.
const auditRetentionSchema = z.union([
  durationSpecSchema,
  z.object({ months: z.number().int().nonnegative() }).strict(),
  z.object({ years: z.number().int().nonnegative() }).strict(),
]);

const authorityNotificationDeadlineSchema = z.union([
  durationSpecSchema,
  z.literal("as-soon-as-feasible"),
  z.literal("in-most-expedient-time"),
  z.literal("manual"),
]);

const userNotificationRequiredSchema = z.union([
  z.literal("if-high-risk"),
  z.literal("if-real-risk-of-significant-harm"),
  z.literal("if-serious-risk-of-injury"),
  z.literal("always-if-encrypted-data-or-pii"),
  z.literal("always-without-undue-delay"),
  z.literal("manual"),
]);

const userRightsOverrideSchema = z
  .object({
    gracePeriod: durationSpecSchema.optional(),
    restrictionAllowed: z.boolean().optional(),
    objectionAllowed: z.boolean().optional(),
    portabilityFormat: z.array(z.string()).optional(),
    auskunftFrist: durationSpecSchema.optional(),
    employeeAccessRight: z.boolean().optional(),
    explicitConsentForAutomatedDecision: z.boolean().optional(),
    doNotSellRequired: z.boolean().optional(),
    // Async-Export-Pipeline (S2.U3+U4) — TTL Compliance-relevant,
    // Stale/Cleanup Operations-Settings.
    exportDownloadTtl: durationSpecSchema.optional(),
    exportStaleTimeoutMinutes: z.number().int().nonnegative().optional(),
    exportStorageCleanupGraceHours: z.number().int().nonnegative().optional(),
  })
  .strict();

const notificationsOverrideSchema = z
  .object({
    languages: z.array(z.string()).optional(),
    languageDefault: z.string().optional(),
    mandatoryBreachNotification: z.boolean().optional(),
  })
  .strict();

const breachOverrideSchema = z
  .object({
    authorityNotificationDeadline: authorityNotificationDeadlineSchema.optional(),
    authorityContact: z.string().optional(),
    userNotificationRequired: userNotificationRequiredSchema.optional(),
    worksCouncilNotificationRequired: z.boolean().optional(),
    mandatoryRegisterOfBreaches: z.boolean().optional(),
  })
  .strict();

const auditLogOverrideSchema = z
  .object({
    retention: auditRetentionSchema.optional(),
    reportFrequency: z
      .union([
        z.literal("quarterly"),
        z.literal("yearly"),
        z.literal("annual-required"),
        z.literal("manual"),
      ])
      .optional(),
  })
  .strict();

const subProcessorOverrideSchema = z
  .object({
    consentRequired: z.boolean().optional(),
    changeNotificationLeadDays: z.number().int().nonnegative().optional(),
    mandatoryBaaWithSubProcessors: z.boolean().optional(),
    worksCouncilApprovalRequired: z.boolean().optional(),
    tierFilter: z.array(z.string()).optional(),
  })
  .strict();

const forgetDiscoveryOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.union([z.literal("manual-redact"), z.literal("auto-redact-strict")]).optional(),
  })
  .strict();

/**
 * Komplett-Schema fuer ComplianceProfileOverride. Alle Top-Level- UND
 * Sub-Level-Keys sind gewhitelisted via .strict() — Tippfehler werfen
 * sofort. Set-profile-Handler (Sprint 1.9 Z3) validiert das Override
 * gegen dieses Schema vor dem Persist.
 */
export const complianceProfileOverrideSchema = z
  .object({
    userRights: userRightsOverrideSchema.optional(),
    notifications: notificationsOverrideSchema.optional(),
    breach: breachOverrideSchema.optional(),
    auditLog: auditLogOverrideSchema.optional(),
    subProcessor: subProcessorOverrideSchema.optional(),
    tenantDestroyGracePeriod: durationSpecSchema.optional(),
    forgetDiscovery: forgetDiscoveryOverrideSchema.optional(),
  })
  .strict();
