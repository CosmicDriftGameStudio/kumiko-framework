---
"@cosmicdrift/kumiko-bundled-features": patch
---

A signing-link secret of only spaces now rejects every link, the same as an empty secret.

<!-- kumiko-changes
feature: signature
type: fix
title: A whitespace-only linkSecret rejects every signing link
detail: `verifyRowBoundGrant` treated a secret of only whitespace as configured and keyed the HMAC with it, so a `linkSecret` of `"   "` accepted links signed with that guessable value. It now counts as unset like `""`: the app still boots and every link of `signature`, `tenant-handover` and `user-data-rights` is refused.
-->
