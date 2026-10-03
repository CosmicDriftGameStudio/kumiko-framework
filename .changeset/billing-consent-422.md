---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

A missing or unchecked checkout consent now fails with `422 consent_required` instead of a schema `400`. `start-plan-checkout` and `create-checkout-session` accept an absent `consent` and `false` flags and reject them in the consent gate, so clients can show the localized `billing-foundation.errors.consentRequired` message.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Missing or unchecked checkout consent returns 422 consent_required
detail: |
  The consent payload is optional in the `start-plan-checkout` and `create-checkout-session` input schemas and its two flags are plain booleans. `prepareConsent` throws `UnprocessableError("consent_required")` with `billing-foundation.errors.consentRequired` when consumer protection is on and the consent is missing or either flag is not true.
migration: |
  Clients that treated the previous `400` validation error for a missing consent as the signal must check for `422` with `reason: "consent_required"`.
-->
