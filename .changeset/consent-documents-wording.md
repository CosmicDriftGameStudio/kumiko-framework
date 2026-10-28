---
"@cosmicdrift/kumiko-bundled-features": patch
---

The documents checkbox in the consent box no longer mentions the privacy policy; the buyer agrees to the terms and, where linked, the refund policy.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Shorter documents checkbox text in the consent box
detail: With `consumerProtection.documentsAcknowledgement: true` the checkbox now reads "I have read and agree to the Terms and the Refund Policy." (de: "Ich habe die AGB und die Erstattungsrichtlinie gelesen und bin mit ihnen einverstanden."), or without a refund link only the terms. The privacy policy stays a link. The text is part of `consentTextVersion`, so apps with the option on get a new version hash; consents recorded earlier keep their stored version.
-->
