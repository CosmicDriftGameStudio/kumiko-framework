---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

PII ciphertext is now GCM-bound to `subjectKey|field` as AAD (format bump to
`kumiko-pii:v2:`). Without it, cut-and-pasting ciphertext between two fields
of the same subject (same DEK) decrypted silently — key selection alone only
catches a wrong subject, not a wrong field. `v1` ciphertext (no AAD) stays
decrypt-only for pre-existing rows; every new write emits `v2`.

`encryptPiiValueForSubject` and `decryptPiiValueForSubject`
(`@cosmicdrift/kumiko-framework`) and `decryptStoredPii`
(`@cosmicdrift/kumiko-bundled-features`) now take a mandatory `field`
parameter that must match the field name used at encrypt time.
