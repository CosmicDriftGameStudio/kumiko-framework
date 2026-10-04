---
"@cosmicdrift/kumiko-testing": minor
---

The e2e kit now works against apps that enforce MFA. `seedTenant({ mfa: "totp" })` enrolls the seeded admin with a confirmed TOTP factor through the real auth-mfa endpoints and returns the base32 secret as `admin.mfaTotpSecret`. `loginViaApi` and `loginViaUi` answer the MFA challenge with that secret when the credentials carry `mfaTotpSecret`; without it they behave as before for accounts that need no MFA. `seedTenant()` also enrolls the admin when the app policy demands MFA (the login answers with a required setup), without the option; the option forces enrollment when no policy does. `enrollTotpViaApi(request, credentials)` is exported for enrolling other users, and `addUser(roles, { mfa: "totp" })` enrolls a seeded user (returned as `mfaTotpSecret`) on a separate request context, so the admin session stays logged in. `loginViaApi` now throws when the account answers with an MFA challenge or a required MFA setup but the credentials carry no `mfaTotpSecret`, instead of returning without a session. Repeated logins in one 30 s window use the next valid TOTP step, because the server burns an accepted code.

<!-- kumiko-changes
feature: testing
type: improvement
title: e2e kit seeds an MFA factor and answers the MFA challenge on login
-->
