// `@cosmicdrift/kumiko-framework/compliance` — Datenschutz/Compliance-
// Foundation. Wird von Sprint-1+ Features genutzt (compliance-profiles,
// data-retention, user-data-rights, ...).

export {
  addDurationSpec,
  describeDurationSpec,
  durationSpecToMs,
} from "./duration-spec.js";
export { complianceProfileOverrideSchema } from "./override-schema.js";
export type {
  AuthorityNotificationDeadline,
  ComplianceProfile,
  ComplianceProfileKey,
  ComplianceProfileOverride,
  DurationSpec,
  EffectiveComplianceProfile,
  UserNotificationRequiredPolicy,
} from "./profiles.js";
export {
  COMPLIANCE_PROFILES,
  OVERRIDABLE_PROFILE_KEYS,
  resolveComplianceProfile,
  SELECTABLE_PROFILE_KEYS,
} from "./profiles.js";
export type { BundleTier, SubProcessor } from "./sub-processors.js";
export {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
} from "./sub-processors.js";
