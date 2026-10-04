---
"@cosmicdrift/kumiko-testing": patch
---

The e2e kit now works against apps that enforce MFA. `seedTenant({ mfa: "totp" })` enrolls the seeded admin with a confirmed TOTP factor through the real auth-mfa endpoints and returns the base32 secret as `admin.mfaTotpSecret`. `loginViaApi` and `loginViaUi` answer the MFA challenge with that secret when the credentials carry `mfaTotpSecret`; without it they behave as before. `enrollTotpViaApi(request, credentials)` is exported for enrolling other users. Repeated logins in one 30 s window use the next valid TOTP step, because the server burns an accepted code.

<!-- kumiko-changes
feature: testing
type: improvement
title: e2e kit seeds an MFA factor and answers the MFA challenge on login
-->
