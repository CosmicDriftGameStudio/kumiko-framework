---
"@cosmicdrift/kumiko-bundled-features": patch
---

The MFA web client reuses the shared `toLoginResponse` helper (now exported from the auth-email-password web barrel) for `landingPath` handling, so login, MFA verify and MFA setup confirm map the response identically.

<!-- kumiko-changes
feature: auth-mfa
type: fix
title: MFA web client shares the login response mapper
-->
