import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const AUTH_EMAIL_PASSWORD_BOOT_RULES = {
  hmacSecretTooShort: {
    id: "auth-email-password/hmac-secret-too-short",
    summary: "Each configured token hmacSecret is at least the minimum length.",
    fix: "Pass an hmacSecret of at least the minimum length.",
  },
} as const satisfies BootRuleTable;
