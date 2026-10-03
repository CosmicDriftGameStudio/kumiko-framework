---
"@cosmicdrift/kumiko-bundled-features": minor
---

`billing-foundation` can gate checkout behind a consumer-protection consent. With `createBillingFoundationFeature({ baseUrl, consumerProtection })`, `start-plan-checkout` and `create-checkout-session` require a `consent` payload (early performance requested, loss of withdrawal right acknowledged, the consent text version and the locale). The server rejects an outdated text version with `consent_text_outdated` and a missing terms text block with `terms_unavailable`. Once the provider has returned the checkout URL, a `checkout-consent-recorded` event is appended to the subscription or payment stream with the consent id, price, text version, terms hash and the acting user; the same consent id, a locale and a submit message go to the provider. The `billing-plans` query additionally returns the German and English consent texts with their versions and the configured legal links.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Optional consumer-protection consent gate on checkout
detail: |
  `BillingFoundationOptions.consumerProtection` (`termsTextBlock`, `vatNote` with `de` and `en`, `operatorEmail`, `legalLinks`) requires `baseUrl` and additionally requires the `template-resolver` and `delivery` features. When set, `start-plan-checkout` and `create-checkout-session` take a strict `consent` object (`earlyPerformanceRequested: true`, `withdrawalLossAcknowledged: true`, `consentTextVersion`, `locale`); a missing or unchecked consent fails validation (400). The consent texts and their version (first 16 hex characters of the SHA-256 of the early-performance and withdrawal-loss texts) are owned by the framework in German and English. After the provider returned the checkout URL, `checkout-consent-recorded` is appended (no email, no IP). `billing-plans` returns `consumerProtection: { consentTexts, legalLinks }` so a client can render and echo the version.
migration: |
  No code change needed unless you enable consumerProtection; then callers of start-plan-checkout/create-checkout-session must send `consent`.
-->
