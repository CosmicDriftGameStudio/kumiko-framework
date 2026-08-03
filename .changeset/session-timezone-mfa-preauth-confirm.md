---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix: the preauth-MFA-enrollment login (`/auth/mfa/preauth-confirm`) now carries the user's existing `timezone` into the minted session, matching password login and the MFA-verify/invite-accept-with-login fix in #1759. This was the one session-mint site that fix missed — an existing user blocked at login by MFA enforcement and completing enrollment through preauth-confirm lost their timezone until their next password login.
