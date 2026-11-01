import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const SUBSCRIPTION_MOLLIE_BOOT_RULES = {
  emptyApiKey: {
    id: "subscription-mollie/empty-api-key",
    summary: "The Mollie provider receives a non-empty apiKey.",
    fix: "Set MOLLIE_API_KEY before mounting.",
  },
  emptyWebhookUrl: {
    id: "subscription-mollie/empty-webhook-url",
    summary: "The Mollie provider receives a non-empty webhookUrl.",
    fix: "Pass the foundation webhook URL Mollie sends events to.",
  },
  priceMapDrift: {
    id: "subscription-mollie/price-map-drift",
    summary: "priceToTier and priceToConfig declare the same price ids.",
    fix: "Make both maps list the same price ids.",
  },
} as const satisfies BootRuleTable;
