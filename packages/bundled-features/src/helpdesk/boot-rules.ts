import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const HELPDESK_BOOT_RULES = {
  invalidProofOfWorkBits: {
    id: "helpdesk/invalid-proof-of-work-bits",
    summary: "spamProtection.proofOfWorkBits is an integer within the allowed range.",
    fix: "Use an integer inside the documented bounds.",
  },
} as const satisfies BootRuleTable;
