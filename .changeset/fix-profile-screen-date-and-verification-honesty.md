---
"@cosmicdrift/kumiko-framework": patch
---

`user-profile` ProfileScreen fixes from review:

- The deletion-grace banner injected `gracePeriodEnd` as a raw ISO instant, so
  users saw "…deleted on 2026-07-11T00:00:00.000Z". It now shows the date part
  only (`formatDeletionDate`, a pure string slice — no Date API, universal for
  RN+Web).
- After an email change the screen fired `requestEmailVerification` with the
  result swallowed (`.catch(() => undefined)`) while unconditionally showing
  "we sent a verification link". A failed send is no longer silent (logged via
  `console.warn`) and the success message no longer promises delivery
  ("Please confirm your new address." / "Bitte bestätige deine neue Adresse.").
  The change itself stays successful regardless, since it is already persisted.
