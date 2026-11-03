import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const PERSONAL_ACCESS_TOKENS_BOOT_RULES = {
  scopeEventWithoutContract: {
    id: "personal-access-tokens/scope-event-without-contract",
    summary: "Events listed in PAT scopes have a public webhook contract.",
    fix: "Declare the event with r.defineWebhookEvent or opt the entity into webhookEvents.",
  },
  releasedWireNameCollision: {
    id: "personal-access-tokens/released-wire-name-collision",
    summary: "Webhook events released through PAT scopes have unique wire names.",
    fix: "Give one of the colliding events another wireName in r.defineWebhookEvent.",
  },
} as const satisfies BootRuleTable;
