import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_PROBE_RULES = {
  nameEmpty: {
    id: "probe/name-empty",
    summary: "A probe name is a non-empty string.",
    fix: "Give the probe a name.",
  },
  nameNotKebab: {
    id: "probe/name-not-kebab",
    summary: "Probe names are kebab-case.",
    fix: "Rename the probe to lowercase letters, digits and dashes.",
  },
  scopeInvalid: {
    id: "probe/scope-invalid",
    summary: "Probe scope is tenant or system.",
    fix: "Set scope to a listed value.",
  },
  costInvalid: {
    id: "probe/cost-invalid",
    summary: "Probe cost is free or paid.",
    fix: "Set cost to a listed value.",
  },
  i18nKeyEmpty: {
    id: "probe/i18n-key-empty",
    summary: "Probe area and label are non-empty i18n keys.",
    fix: "Set area and label to i18n keys.",
  },
  timeoutInvalid: {
    id: "probe/timeout-invalid",
    summary: "Probe timeoutMs is greater than zero.",
    fix: "Set timeoutMs above zero or omit it.",
  },
  runNotFunction: {
    id: "probe/run-not-function",
    summary: "Probe run is a function.",
    fix: "Pass a run function.",
  },
  targetsNotFunction: {
    id: "probe/targets-not-function",
    summary: "Probe targets is a function when set.",
    fix: "Pass a function or omit targets.",
  },
  duplicate: {
    id: "probe/duplicate",
    summary: "Probe names are unique per feature.",
    fix: "Rename one of the probes.",
  },
} as const satisfies BootRuleTable;
