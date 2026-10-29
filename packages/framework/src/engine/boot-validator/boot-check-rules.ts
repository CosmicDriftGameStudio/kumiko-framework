import type { BootRuleTable } from "./boot-rule.ts";

export const BOOT_CHECK_RULES = {
  failed: {
    id: "boot-check/failed",
    summary: "A feature's r.bootCheck invariant holds for the mounted feature set.",
    fix: "Satisfy the invariant named in the message or unmount the feature that declares it.",
  },
} as const satisfies BootRuleTable;
