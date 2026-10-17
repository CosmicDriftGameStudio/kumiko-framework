---
"@cosmicdrift/kumiko-bundled-features": patch
---

Magic-link mail expiry and app name use the template locale

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Magic-link mail expiry and app name use the template locale
detail: The expiry text, the app-name fallback and the notify locale follow the locale the auth mail template actually renders in, while the link keeps the request locale.
-->
