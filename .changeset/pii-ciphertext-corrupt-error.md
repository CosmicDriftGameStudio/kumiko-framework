---
"@cosmicdrift/kumiko-framework": minor
---

A PII value that does not decrypt under its subject key now rejects with `PiiCiphertextCorruptError` (code `pii_ciphertext_corrupt`, exported from `@cosmicdrift/kumiko-framework/crypto`), so a caller can tell a damaged value apart from a key store outage (`EncryptionUnavailableError`) and from a missing key (`KeyNotFoundError`).

<!-- kumiko-changes
feature: framework
type: improvement
title: Corrupt PII ciphertext has its own error type
detail: `decryptPiiFieldValues`, `decryptPiiValueForSubject` and every read path built on them threw Node's generic "unable to authenticate data" error for a failed GCM auth tag, the same shape as any other failure. Now a failed auth tag, an AAD mismatch (value copied into another field or subject), a malformed ciphertext and an undecodable jsonb plaintext throw `PiiCiphertextCorruptError` with the field name; it is a KumikoError, so it keeps its code through the dispatcher. An export can blank one such row and still fail loud on an outage, which keeps its own `EncryptionUnavailableError`.
-->
