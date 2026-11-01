import type { BootRuleTable } from "./boot-rule.ts";

export const FEATURE_DEFINITION_RULES = {
  dedupeOptionsNotComparable: {
    id: "feature/dedupe-options-not-comparable",
    summary: "dedupeOptions values are primitives or stable function references.",
    fix: "Replace nested objects in dedupeOptions with primitives or a module-level function reference.",
  },
  describeTwice: {
    id: "feature/describe-twice",
    summary: "A feature calls r.describe() at most once.",
    fix: "Remove the second r.describe() call.",
  },
  describeTextEmpty: {
    id: "feature/describe-text-empty",
    summary: "r.describe() receives a non-empty string.",
    fix: "Pass a non-empty description text.",
  },
  requiresNeedsFeatures: {
    id: "feature/requires-needs-features",
    summary: "r.requires() receives { features: string[] }.",
    fix: 'Pass the feature names as r.requires({ features: ["other-feature"] }).',
  },
  toggleableTwice: {
    id: "feature/toggleable-twice",
    summary: "A feature calls r.toggleable() at most once.",
    fix: "Remove the second r.toggleable() call.",
  },
  uiHintsTwice: {
    id: "feature/ui-hints-twice",
    summary: "A feature calls r.uiHints() at most once.",
    fix: "Merge all UI hints into a single r.uiHints() call.",
  },
  argumentMissing: {
    id: "registrar/argument-missing",
    summary: "Every registrar method receives all its required arguments.",
    fix: "Pass the missing argument named in the message.",
  },
  optionsObjectRequired: {
    id: "registrar/options-object-required",
    summary: "Object-form registrar methods take one options object.",
    fix: "Pass a single options object such as r.entity({ name: ... }).",
  },
} as const satisfies BootRuleTable;
