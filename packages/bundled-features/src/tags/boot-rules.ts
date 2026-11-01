import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const TAGS_BOOT_RULES = {
  emptyParentsAllowlist: {
    id: "tags/empty-parents-allowlist",
    summary: "The parents allowlist is omitted or non-empty.",
    fix: "Omit parents or list at least one entity.",
  },
} as const satisfies BootRuleTable;
