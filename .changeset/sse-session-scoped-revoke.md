---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A "revoke every other session" write (auth-mfa enable-confirm, disable, regenerate-recovery, sessions revoke-all-others) no longer closes the caller's own SSE stream, so a live status panel now sees the change. `session-revoked` carries a new optional `keptSessionId`; only that one session's streams are spared, every other stream of the user still closes, including one from a session already logged out. All other invalidation reasons stay userwide, and anything without a valid `keptSessionId` fails closed to userwide, which also keeps a mixed rolling deploy safe.

<!-- kumiko-changes
feature: framework
type: fix
title: Revoking all other sessions no longer closes the caller's own live stream
-->
