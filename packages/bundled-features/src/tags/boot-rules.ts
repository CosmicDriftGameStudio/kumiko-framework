import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const TAGS_BOOT_RULES = {
  emptyParentsAllowlist: {
    id: "tags/empty-parents-allowlist",
    summary: "The parents allowlist names at least one host entity.",
    fix: "List at least one host entity in parents.",
  },
} as const satisfies BootRuleTable;
