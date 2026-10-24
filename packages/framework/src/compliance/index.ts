// `@cosmicdrift/kumiko-framework/compliance` — Data protection and compliance foundation.
// Used by compliance-profiles, data-retention, user-data-rights, and related features.

export {
  addDurationSpec,
  subtractRetentionSpec,
} from "./duration-spec.ts";
export { complianceProfileOverrideSchema } from "./override-schema.ts";
export type {
  ComplianceProfile,
  ComplianceProfileKey,
  ComplianceProfileOverride,
  DurationSpec,
  EffectiveComplianceProfile,
} from "./profiles.ts";
export {
  COMPLIANCE_PROFILES,
  resolveComplianceProfile,
  SELECTABLE_PROFILE_KEYS,
} from "./profiles.ts";
export type { SubProcessor } from "./sub-processors.ts";
export {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
} from "./sub-processors.ts";
