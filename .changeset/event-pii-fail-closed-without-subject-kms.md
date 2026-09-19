---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Event-PII stops failing open without a subject KMS (fw#2776)

`defineEvent` has required an explicit PII stance since fw#2558, but a declared stance still did not guarantee ciphertext in `kumiko_events`. Two paths leaked silently and now fail closed.

Boot: `assertPiiBootInvariants` only looked at entity annotations, so an app whose PII lives exclusively in catalogued events booted without a `kms` adapter and wrote plaintext. It now collects events with a non-`"none"` stance alongside the PII entities — prod aborts, dev warns, `allowPlaintextPii: "<reason>"` acknowledges, same as for entities.

Append: `{ personal: { of: "<ownerField>" } }` skipped encryption whenever the owner field carried no id, so the same event type was ciphertext for user-triggered writes and plaintext for system-triggered ones with no signal. The stance now carries `whenAbsent`: `"tenant"` encrypts under the envelope tenant key, `"plaintext"` is an explicit acknowledgement that the value cannot be crypto-shredded. Registration rejects a nullable owner field without one, and an owner that is empty at append time with no declared fallback aborts the write instead of storing the value in the clear.

`delivery:event:attempt` declares `whenAbsent: "tenant"` — a send whose `recipientId` is null now stores the recipient address under the tenant key instead of in plaintext.

<!-- kumiko-changes
feature: framework
type: breaking
title: Declared event PII fails closed without a subject KMS (fw#2776)
migration: |
  Three things can newly fail.

  1. Boot aborts with "BOOT ABORTED — ... events [...]" when a mounted feature
     declares a non-"none" `piiFields` stance and `runProdApp`/`runWorkerApp`
     gets no `kms`. Pass `kms: createPgKmsAdapter({ databaseUrl, platformKek })`,
     or acknowledge the plaintext with `allowPlaintextPii: "<reason>"` until the
     KMS is provisioned. `runDevApp` only warns.
  2. Registration aborts when a `{ personal: { of: "<ownerField>" } }` stance
     names an owner field the payload schema allows to be null or undefined.
     Add `whenAbsent: "tenant"` to encrypt those writes under the envelope
     tenant key, or `whenAbsent: "plaintext"` to declare that the value ships
     unencrypted and is not crypto-shreddable. The deprecated
     `{ subjectField: "<ownerField>" }` form cannot express `whenAbsent` —
     move it to the canonical `{ personal: { of: ... } }` form.
  3. `append()` throws `SubjectResolutionError` when the owner field is empty
     at write time and the event declared no `whenAbsent`. Registration catches
     this for ZodObject payload schemas; a non-object schema surfaces it here.
     An owner value that is not a non-empty string — a numeric id, an empty
     string — counts as absent, so it takes the same path and needs the same
     declaration.

  `delivery:event:attempt` rows written with a null `recipientId` used to hold a
  plaintext recipient address in `kumiko_events` and in `store_delivery_attempts`.
  New rows are tenant-subject ciphertext. `delivery:query:log` decrypts either
  form, so the admin log view is unchanged; tooling that reads
  `store_delivery_attempts.recipient_address` directly must go through
  `decryptStoredPii`. Existing plaintext rows stay readable and are re-encrypted
  by `backfillEventPiiEncryption`.
-->
