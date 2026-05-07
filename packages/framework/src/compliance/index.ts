// `@cosmicdrift/kumiko-framework/compliance` — Datenschutz/Compliance-
// Foundation. Wird von Sprint-1+ Features genutzt (compliance-profiles,
// data-retention, user-data-rights, ...).

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
  SELECTABLE_PROFILE_KEYS,
  resolveComplianceProfile,
} from "./profiles";
export type { BundleTier, SubProcessor } from "./sub-processors";
export {
  KUMIKO_SUB_PROCESSORS,
  getActiveSubProcessors,
  getPlannedSubProcessors,
} from "./sub-processors";
