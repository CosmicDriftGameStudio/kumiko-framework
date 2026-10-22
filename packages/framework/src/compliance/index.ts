// `@cosmicdrift/kumiko-framework/compliance` — Data protection and compliance foundation.
// Used by compliance-profiles, data-retention, user-data-rights, and related features.

export {
  addDurationSpec,
  describeDurationSpec,
  durationSpecToMs,
  subtractRetentionSpec,
} from "./duration-spec.ts";
export { complianceProfileOverrideSchema } from "./override-schema.ts";
export type {
  AuthorityNotificationDeadline,
  ComplianceProfile,
  ComplianceProfileKey,
  ComplianceProfileOverride,
  DurationSpec,
  EffectiveComplianceProfile,
  RetentionSpec,
  UserNotificationRequiredPolicy,
} from "./profiles.ts";
export {
  COMPLIANCE_PROFILES,
  OVERRIDABLE_PROFILE_KEYS,
  resolveComplianceProfile,
  SELECTABLE_PROFILE_KEYS,
} from "./profiles.ts";
export type { BundleTier, SubProcessor } from "./sub-processors.ts";
export {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
} from "./sub-processors.ts";
