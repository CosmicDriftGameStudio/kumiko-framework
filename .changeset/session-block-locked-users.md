---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Block locked accounts at the session layer (defense-in-depth)

The session checker now reads the user's lifecycle status on every authenticated request and refuses a live session whose user is `restricted` or `deleted`, returning the new `"blocked"` `AuthSessionStatus` (401). This is a second layer on top of session revocation: a missed revoke can no longer keep a locked account authenticated. `active` and `deletionRequested` users are unaffected (the latter keeps its session so it can still cancel a pending deletion). The check fails open on a user-row miss so a lookup issue degrades to "revocation still protects" rather than a global lockout. The `sessions` feature now declares `r.requires("user")`.
