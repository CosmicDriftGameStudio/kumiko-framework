---
"@cosmicdrift/kumiko-bundled-features": minor
---

Remove subscription-dodo, replaced by subscription-paddle

Removed exports of @cosmicdrift/kumiko-bundled-features/subscription-dodo: DODO_BASE_URLS, DODO_PROVIDER_NAME, DodoEnvironment, DodoEnvironments, SUBSCRIPTION_DODO_FEATURE, SubscriptionDodoOptions, createSubscriptionDodoFeature, dodoEnvSchema, subscriptionDodoEnvSchema.

<!-- kumiko-changes
feature: subscription-paddle
type: breaking
title: Remove subscription-dodo, replaced by subscription-paddle
migration: |
  Replace createSubscriptionDodoFeature with createSubscriptionPaddleFeature from @cosmicdrift/kumiko-bundled-features/subscription-paddle and dodoEnvSchema with paddleEnvSchema. Map Paddle price ids (pri_...) to tiers in priceToTier, set PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_TENANT_BINDING_KEY and PADDLE_CLIENT_TOKEN (or the matching config keys) and point the Default Payment Link at /billing/paddle-checkout. Point the Paddle notification destination at /webhooks/subscription/paddle when billing is mounted through the server-runtime boot option (SUBSCRIPTION_WEBHOOK_PATH), or at /api/subscription/webhook/paddle when createSubscriptionWebhookRoute is mounted by hand. In server-runtime boot options, billing.dodo becomes billing.paddle. An app-own credit-pack env such as DODO_PRODUCT_PACKS becomes a list of Paddle pri_ ids; the pack size comes from the price or product custom_data.credits, which surfaces as ProviderPrice.metadata.credits. Existing Dodo subscriptions are not migrated; a subscription stays with the provider stored on it.
-->
