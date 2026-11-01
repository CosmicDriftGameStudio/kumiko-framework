import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const NOTES_HISTORY_BOOT_RULES = {
  emptyParentsAllowlist: {
    id: "notes-history/empty-parents-allowlist",
    summary: "The parents allowlist is omitted or non-empty.",
    fix: "Omit parents or list at least one entity.",
  },
} as const satisfies BootRuleTable;
