import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const JOBS_BOOT_RULES = {
  anonymousReadRole: {
    id: "jobs/anonymous-read-role",
    summary: "The jobs readRoles option does not contain anonymous.",
    fix: "Remove anonymous from readRoles.",
  },
} as const satisfies BootRuleTable;
