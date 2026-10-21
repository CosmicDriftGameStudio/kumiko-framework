// Zod schema for ComplianceProfileOverride with recursive `.strict()` validation.
//
// Previously, set-profile.write.ts checked only top-level keys against
// OVERRIDABLE_PROFILE_KEYS. Sub-level typos (for example,
// `{ userRights: { weeks: 3 } }` instead of
// `{ userRights: { gracePeriod: { days: 30 } } }`) passed through —
// deepMerge spliced the nonsense into the effective profile, and a caller
// reading `userRights.gracePeriod.days` crashed with `undefined`.
//
// The schema maps the ComplianceProfile structure to DeepPartial form and
// uses `.strict()` on every object so unknown keys throw. It is a single
// source of truth like OVERRIDABLE_PROFILE_KEYS, with sub-level coverage.
//
// Identification fields (`key`, `region`, `label`, `extends`) are excluded
// from the schema because overriding them would destroy profile identity.

import * as z from "zod";

// DurationSpec: { days } | { hours } — strict bedeutet beide Forms
// muessen exakt 1 property haben (kein "{ days: 30, hours: 1 }").
const durationSpecSchema = z.union([
  z.object({ days: z.number().int().nonnegative() }).strict(),
  z.object({ hours: z.number().int().nonnegative() }).strict(),
]);

// retention.* additionally allows `"months"` and `"years"`; this remains
// a strict disjunction.
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
    // Async-Export-Pipeline — TTL Compliance-relevant,
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
 * Complete schema for ComplianceProfileOverride. All top-level and
 * sub-level keys are whitelisted with `.strict()`, so typos throw
 * immediately. The set-profile handler validates the override against
 * this schema before persisting it.
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
