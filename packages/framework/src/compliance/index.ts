// `@cosmicdrift/kumiko-framework/compliance` — Datenschutz/Compliance-
// Foundation. Wird von Sprint-1+ Features genutzt (compliance-profiles,
// data-retention, user-data-rights, ...).

export {
  addDurationSpec,
  describeDurationSpec,
  durationSpecToMs,
} from "./duration-spec";
export { complianceProfileOverrideSchema } from "./override-schema";
export type {
  AuthorityNotificationDeadline,
  ComplianceProfile,
  ComplianceProfileKey,
  ComplianceProfileOverride,
  DurationSpec,
  EffectiveComplianceProfile,
  UserNotificationRequiredPolicy,
} from "./profiles";
export {
  COMPLIANCE_PROFILES,
  OVERRIDABLE_PROFILE_KEYS,
  resolveComplianceProfile,
  SELECTABLE_PROFILE_KEYS,
} from "./profiles";
export type { BundleTier, SubProcessor } from "./sub-processors";
export {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
} from "./sub-processors";
