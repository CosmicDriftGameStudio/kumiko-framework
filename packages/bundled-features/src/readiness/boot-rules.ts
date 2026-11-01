import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const READINESS_BOOT_RULES = {
  probeTranslationMissing: {
    id: "readiness/probe-translation-missing",
    summary: "Probe area and label keys are defined by a mounted feature.",
    fix: "Add the key via r.translations(...).",
  },
  probeFixScreenUnknown: {
    id: "readiness/probe-fix-screen-unknown",
    summary: "A probe fixScreen names a screen of a mounted feature.",
    fix: "Use a <feature>:screen:<id> qualified name of a mounted screen.",
  },
} as const satisfies BootRuleTable;
