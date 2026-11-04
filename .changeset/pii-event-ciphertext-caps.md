---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Inbound-mail event schemas now size their PII fields for ciphertext, so a subject, snippet or sender at its plaintext limit no longer fails the append.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: ingest-message no longer rejects mails whose encrypted fields reach the plaintext limit
detail: The `inbound-message-received` and `mail-thread-updated` payload schemas capped from, to, cc, subject and snippet at the plaintext limits, but the payload holds PII ciphertext (envelope plus Base64), so a 4000-character subject or snippet failed with "Validation failed" once a PII KMS was configured. The limits now come from the new `piiCiphertextMaxLengthFor` in `@cosmicdrift/kumiko-framework/crypto`.
-->
