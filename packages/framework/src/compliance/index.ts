// `@cosmicdrift/kumiko-framework/compliance` — Datenschutz/Compliance-
// Foundation. Wird von Sprint-1+ Features genutzt (compliance-profiles,
// data-retention, user-data-rights, ...).

export type { BundleTier, SubProcessor } from "./sub-processors";
export {
  KUMIKO_SUB_PROCESSORS,
  getActiveSubProcessors,
  getPlannedSubProcessors,
} from "./sub-processors";
