---
"@cosmicdrift/kumiko-bundled-features": minor
---

With `consumerProtection` set, the `BillingPlansPanel` of `billing-foundation` now guards the checkout and offers the cancellation path. Choosing a plan opens an order summary (plan, price, renewal interval, cancellation note, links to terms, withdrawal policy and privacy) with two unchecked consent checkboxes that show the server-provided texts in the UI language (`de` or `en`, otherwise `de`). The "Order with obligation to pay" button stays disabled until both are ticked and sends the consent with the server's text version. If the texts changed (`consent_text_outdated`), the dialog shows the error, clears the boxes and reloads the plans. Tenant admins with a live subscription also get a "Cancel contract here" button: termination or withdrawal, ordinary or extraordinary (reason required), a confirmation step, then the receipt with time of receipt and effective date. Without `consumerProtection` the panel behaves as before.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Consent dialog and cancel-contract button in the billing panel
detail: |
  The checkout CTA opens `CheckoutConsentDialog` when `billing-plans` returns `consumerProtection`; `start-plan-checkout` then receives `consent: { earlyPerformanceRequested, withdrawalLossAcknowledged, consentTextVersion, locale }`. The locale rule (`resolveConsentLocale`) moved to the crypto-free `consumer-protection/consent-locale.ts` and is still re-exported from `consent-text.ts`. `CancelContractDialog` calls `billing-foundation:write:terminate-contract`. New English i18n keys under `billing-foundation.consent.*` and `billing-foundation.cancel.*`.
migration: |
  No action. Apps that translate the panel add the new `billing-foundation.consent.*` and `billing-foundation.cancel.*` keys to their locale bundles.
-->
