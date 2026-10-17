---
"@cosmicdrift/kumiko-bundled-features": patch
---

Auth gate falls back to the built-in login when the loginUrl builder fails

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: A loginUrl builder that throws no longer crashes the app tree
detail: The auth gate resolves the login redirect once per location change and, when the builder returns an invalid URL or throws, logs the error and shows the built-in login screen instead of throwing during render.
-->
