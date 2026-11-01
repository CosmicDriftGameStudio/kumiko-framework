import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const CONTACT_BOOT_RULES = {
  invalidProofOfWorkBits: {
    id: "contact/invalid-proof-of-work-bits",
    summary: "spamProtection.proofOfWorkBits is an integer within the allowed range.",
    fix: "Use an integer inside the documented bounds.",
  },
} as const satisfies BootRuleTable;
