---
"@cosmicdrift/kumiko-bundled-features": patch
---

When a session ends while a form holds unsaved input, the login now appears over the app instead of replacing it, so the input survives signing in again.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: A session end no longer throws away unsaved form input
detail: Until now a revoked or expired session swapped the whole app for the login screen, and typed but unsaved input was lost without warning. If a form has registered unsaved input (`useUnsavedInputSource`, which the framework's write forms do), the auth gate now keeps the app mounted and shows the login as a full-screen dialog with the "session ended" hint; a configured `loginUrl` is not followed in that case. Signing in again as the same user in the same tenant closes the dialog and the input can be saved. Signing in as another user or into another tenant reloads the page. Without unsaved input nothing changes. `SessionState` has the new optional field `inputKeptOnSessionEnd`.
-->
