---
"@cosmicdrift/kumiko-bundled-features": patch
---

AuthGate accepts a loginUrl function and LoginScreen follows a validated next

`AuthGateOptions.loginUrl` may now be a function `(locale, returnPath) => string` in addition to a string. When the user is already on the login route, the gate renders the LoginScreen instead of redirecting. After a successful login (and MFA verify or setup), the screen follows the `next` query parameter, but only for relative same-origin paths: no `//`, no scheme, no backslash, no control characters.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: AuthGate accepts a loginUrl function, renders LoginScreen on the login route, and LoginScreen follows a validated next
migration: No action needed. String loginUrl keeps working.
-->
