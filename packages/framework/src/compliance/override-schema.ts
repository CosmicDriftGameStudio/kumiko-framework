// Zod schema for ComplianceProfileOverride with recursive `.strict()` validation.
//
// A top-level key whitelist alone would let sub-level typos (for example,
// `{ userRights: { weeks: 3 } }` instead of
// `{ userRights: { gracePeriod: { days: 30 } } }`) pass through —
// deepMerge spliced the nonsense into the effective profile, and a caller
// reading `userRights.gracePeriod.days` crashed with `undefined`.
//
// The schema maps the ComplianceProfile structure to DeepPartial form and
// uses `.strict()` on every object so unknown keys throw. It is the single
// source of truth for the override whitelist; profiles.test.ts checks it
// against ComplianceProfile.
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

const userRightsOverrideSchema = z
  .object({
    gracePeriod: durationSpecSchema.optional(),
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
  })
  .strict();

const breachOverrideSchema = z
  .object({
    authorityContact: z.string().optional(),
  })
  .strict();

const auditLogOverrideSchema = z
  .object({
    retention: auditRetentionSchema.optional(),
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
    tenantDestroyGracePeriod: durationSpecSchema.optional(),
  })
  .strict();
