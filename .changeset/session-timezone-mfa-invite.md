---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix: MFA-verify and invite-accept-with-login now carry the user's existing `timezone` into the minted session, matching password login (fw#1636). Previously only `login.write.ts` threaded it through, so users authenticating via MFA or accepting an invite while already having an account lost their timezone until their next password login.
