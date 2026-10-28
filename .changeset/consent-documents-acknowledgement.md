---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

The consumer-protection consent box of billing-foundation can show a refund policy link and, per app opt-in, require a checkbox confirming that the terms, the privacy policy and the refund policy were read and accepted.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Consent box takes a refund policy link and an optional documents checkbox
detail: `legalLinks.refund` is rendered next to the other links in the checkout and plan-switch dialogs. `consumerProtection.documentsAcknowledgement: true` adds a required first checkbox whose text depends on whether a refund link is set for the locale. The text joins `consentTextVersion` only when the option is on, `start-plan-checkout`, `create-checkout-session` and `switch-plan` then reject a consent without `documentsAcknowledged: true` with 422 `consent_required`, and the recorded consent stores the flag. Without the option nothing changes, including the version. New i18n key `billing-foundation.consent.link.refund`.
-->
