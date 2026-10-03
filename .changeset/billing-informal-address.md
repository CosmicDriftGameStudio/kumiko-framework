---
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The billing consent and cancel-contract dialogs now address the user informally ("du" in German, "tú" in Spanish), like the rest of `BillingPlansPanel`. The German contract confirmation mail, the receipt mail for a termination or withdrawal and the public cancellation pages use "du" as well.

<!-- kumiko-changes
feature: locale-de
type: fix
title: Billing consent and cancel dialogs use "du"
detail: |
  `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` switch from "Sie" to "du", matching the `billing-foundation.plans.*` keys. The formal bundle (`address: "formal"`) keeps the "Sie" wording through `localeDeFormalOverrides`.
-->

<!-- kumiko-changes
feature: locale-es
type: fix
title: Billing consent and cancel dialogs use "tú"
detail: |
  `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` switch from "usted" to "tú", matching the `billing-foundation.plans.*` keys.
-->

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Contract confirmation, termination receipt and cancellation pages use "du"
detail: |
  The German contract confirmation mail, the termination and withdrawal receipt mail, the public cancellation pages and the subscription and payment submit messages address the customer with "du". The recorded consent statements are first-person and unchanged, so `consentTextVersion` stays the same.
-->
