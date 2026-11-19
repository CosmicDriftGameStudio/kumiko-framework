import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const NOTES_HISTORY_BOOT_RULES = {
  emptyParentsAllowlist: {
    id: "notes-history/empty-parents-allowlist",
    summary: "The parents allowlist names at least one host entity.",
    fix: "List at least one host entity in parents.",
  },
} as const satisfies BootRuleTable;
