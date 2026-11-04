---
"@cosmicdrift/kumiko-bundled-features": patch
---

The inbound-mail and billing read models and event schemas now size their PII fields for ciphertext, so values at their plaintext limit no longer fail validation.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: PII ciphertext limits on inbound-mail entities and the mail-account event
detail: The `inbound-message`, `mail-thread` and `mail-account` read-model fields for from, to, cc, subject, snippet, address, bodyText and bodyHtml, and the `address`, `bodyText` and `bodyHtml` of the event payloads, capped at plaintext or rough limits although they hold PII ciphertext (envelope plus Base64). A sender, subject, snippet or 320-character address at its plaintext limit failed validation once a PII KMS was configured. Their limits now come from `piiCiphertextMaxLengthFor` in `@cosmicdrift/kumiko-framework/crypto`.
-->

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: PII ciphertext limits on the provider ids of the billing events
detail: `providerCustomerId` and `providerSubscriptionId` of the subscription and payment event payloads hold PII ciphertext of an id of up to 200 characters; their limit of 1000 was a rough guess and now comes from `piiCiphertextMaxLengthFor` in `@cosmicdrift/kumiko-framework/crypto`.
-->
