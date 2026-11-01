import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const PRESENCE_BOOT_RULES = {
  invalidTtlSeconds: {
    id: "presence/invalid-ttl-seconds",
    summary: "The presence ttlSeconds option is a positive number.",
    fix: "Pass a positive ttlSeconds.",
  },
} as const satisfies BootRuleTable;
