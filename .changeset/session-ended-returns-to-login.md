---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Ended session leads back to the login screen

When the server ends a session (revoked, expired), the app now shows the login screen with a short hint instead of a raw error banner. After signing in again the user lands on the same screen as before.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Ended session leads back to the login screen
-->
