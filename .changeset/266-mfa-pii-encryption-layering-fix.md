---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Fix `auth-mfa` crashing on enable/regenerate for any app with per-subject
crypto-shredding (`configurePiiSubjectKms`) active: `recoveryCodes` was a
`jsonb` field marked `userOwned`, but the PII-encryption pipeline requires a
string value for any subject-owned field — every real enable-confirm write
threw `PII field "recoveryCodes" must be a string, got object`.

`recoveryCodes` is now a `createTextField({ encrypted: true, userOwned })`
(JSON-stringified at the write/read boundary), matching `totpSecret`.

That exposed a second, deeper bug: a field carrying both `encrypted: true`
and a subject marker is written as `PII(envelope(plaintext))`, but
`decryptForRead` peeled the layers in write order instead of reverse order,
so the envelope cipher choked on a still-PII-wrapped string. Fixed
`event-store-executor-context.ts`'s `decryptForRead` to unwrap PII first,
then envelope — and updated `auth-mfa`'s KEK-reencrypt job (which reads raw
rows, bypassing `decryptForRead`) to do the same.

Also: `MfaEnableScreen` now takes an optional `onEnabled` callback, fired
after a successful enable-confirm — hosts that compose it inside their own
MFA-status view (like kumiko-studio's account-security screen) need it to
know when to refetch and swap away from the embedded enable flow.
