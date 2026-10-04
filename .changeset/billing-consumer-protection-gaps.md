---
"@cosmicdrift/kumiko-bundled-features": minor
---

All changes below apply only when `createBillingFoundationFeature` gets `consumerProtection`. Apps without it behave as before.

`ConsumerProtectionOptions.legalLinks` takes either one `LegalLinkSet` or one set per consent locale (`{ de, en }`, both required). `BillingPlansResult.consumerProtection.legalLinks` is now always `Record<"de" | "en", LegalLinkSet>`; a single set is returned for both locales. Code that reads `legalLinks.terms` from the billing-plans result must read `legalLinks[locale].terms`. `CheckoutConsentDialog` picks the set for the consent locale.

`FALLBACK_CONSENT_LOCALE` is now `"en"` (was `"de"`). A locale other than de/en, or none, resolves to English in `resolveConsentLocale`, the consent gate, the confirmation mail's VAT note and the termination record.

`create-checkout-session` with consumer protection now checks in this order: provider, billing enabled, redirect origins, price and subscription gates, then the live price (new `UnprocessableError` `price_unavailable` when the provider cannot return it), then the consent, then the provider call. A missing consent no longer hides a disabled provider, an existing subscription or an unknown price. Its payload schema is strict, so unknown fields are rejected. `assertCheckoutAllowed` and `startProviderCheckout` split `openCheckout` in checkout-core.

New option `ConsumerProtectionOptions.oneOffItemLabel(ctx, priceId)`: the server resolves the label of a one-off item (for example a credit pack). It is stored on the consent event as `itemLabelKey` / `itemLabelParams` and shown in the confirmation mail as "Leistung" / "Item". The client cannot set it.

The terms text block is read from the system tenant, not from the buyer's tenant, in the consent gate and the confirmation mail. A tenant-owned block with the same slug no longer changes `termsHash` or the mailed text.

The confirmation mail shows dates in the recipient's time zone (user zone, else tenant zone, else UTC) with the zone name, renders the terms as Markdown with real headings and shows the translated plan name (`catalog.tierLabelKey`, looked up through the registry i18n, so the key must be qualified with the registering feature; untranslated keys fall back to the raw tier). Its opening sentence starts with a capital letter.

New exports: `consentPayloadSchema`, `ConsentPayload`, `OrderItem`, `CONSENT_LOCALES`, `ConsentLocale`, `resolveConsentLocale`, `LegalLinkSet`. The `/web` entry adds `CheckoutConsentDialog`, `CheckoutConsentDialogProps`, `CheckoutConsentPayload`, `CONSENT_TEXT_OUTDATED_CODE`, `resolveConsentLocale`, `ConsentLocale` and `LegalLinkSet`. `CheckoutConsentDialog` `price.count` is optional, and the "cancel at any time" note only shows for a recurring price (`price.renewalKey` set).

The checkout and cancel dialogs no longer repeat the modal title as a heading, and the cancel-contract button is hidden once a cancellation is scheduled.

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: Consumer-protection gaps - per-locale legal links, gate order, confirmation mail, exports
migration: |
  Only apps that pass consumerProtection are affected. BillingPlansResult.consumerProtection.legalLinks is now keyed by locale (legalLinks.de / legalLinks.en). FALLBACK_CONSENT_LOCALE changed from de to en. create-checkout-session rejects unknown payload fields when consumer protection is on.
-->
