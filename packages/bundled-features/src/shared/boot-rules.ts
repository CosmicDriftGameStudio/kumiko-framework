import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const SHARED_BOOT_RULES = {
  whereRuleInOwnershipWrite: {
    id: "shared/where-rule-in-ownership-write",
    summary: "ownership.write of a bundled-feature factory contains no where rule.",
    fix: "Drop the where rule from ownership.write; it only applies on the read path.",
  },
} as const satisfies BootRuleTable;
