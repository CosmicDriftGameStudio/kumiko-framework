import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const PERSONAL_ACCESS_TOKENS_BOOT_RULES = {
  scopeEventWithoutContract: {
    id: "personal-access-tokens/scope-event-without-contract",
    summary: "Events listed in PAT scopes have a public webhook contract.",
    fix: "Declare the event with r.defineWebhookEvent or opt the entity into webhookEvents.",
  },
} as const satisfies BootRuleTable;
