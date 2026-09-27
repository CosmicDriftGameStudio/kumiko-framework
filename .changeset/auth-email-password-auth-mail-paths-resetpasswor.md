---
"@cosmicdrift/kumiko-bundled-features": patch
---

AuthPaths entries accept a locale function, not just a plain path

AuthPaths (and DEFAULT_AUTH_PATHS/makeAuthPaths) previously typed every entry as a plain string, so an app needing a locale-in-path reset link (/de/reset-password) had to set auth.passwordReset explicitly instead of auth.mail.paths — and since that block requires its own hmacSecret, the app ended up threading its own secret instead of the one auth.mail resolves, decoupling reset-token signing from that secret's rotation. Each AuthPaths entry now accepts a plain path or a (locale) => path function, mirroring the appUrl shape every flow's options already take, so a locale-aware reset link needs only auth.mail.paths.resetPassword, never a hand-rolled passwordReset block.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: AuthPaths entries accept a locale function, not just a plain path
-->
